import { gunzipSync } from 'node:zlib';

/**
 * Reads the terminal's PTY archive the server hands out (`install/tar.ts` writes it at build time: POSIX ustar, regular
 * files, gzipped), in memory, so a runner updating itself unpacks it without starting `tar`. A path that is absolute or
 * leaves its folder, and any entry but a regular file or a folder, refuse the whole archive.
 */

export interface UntarEntry {
  /** The path inside the archive, with `/`, relative. */
  readonly path: string;
  readonly mode: number;
  readonly body: Uint8Array;
}

const BLOCK = 512;

/** A NUL-terminated text field of the header. */
function field(header: Uint8Array, start: number, length: number): string {
  const bytes = header.subarray(start, start + length);
  const end = bytes.indexOf(0);
  return Buffer.from(end === -1 ? bytes : bytes.subarray(0, end)).toString('utf8');
}

/** An octal number field of the header. */
function octal(header: Uint8Array, start: number, length: number): number {
  const text = field(header, start, length).trim();
  const value = Number.parseInt(text || '0', 8);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`a bad number in the archive: ${text}`);
  return value;
}

/** True for a relative path that stays in its folder. */
export function isSafePath(path: string): boolean {
  if (path === '' || path.startsWith('/')) return false;
  return path.split('/').every((part) => part !== '..');
}

/** The regular files of a gzipped ustar archive, in order; throws on an entry it does not take. */
export function untarGz(archive: Uint8Array): UntarEntry[] {
  const tar = gunzipSync(archive);
  const entries: UntarEntry[] = [];
  let offset = 0;
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const name = field(header, 0, 100);
    const prefix = field(header, 345, 155);
    const path = prefix === '' ? name : `${prefix}/${name}`;
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] as number);
    const start = offset + BLOCK;
    if (!isSafePath(path.replace(/\/$/, ''))) throw new Error(`a path that leaves its folder: ${path}`);
    if (start + size > tar.length) throw new Error(`the archive ends inside ${path}`);
    if (type === '0' || type === '\0') {
      entries.push({ path, mode: octal(header, 100, 8) & 0o777, body: tar.subarray(start, start + size) });
    } else if (type !== '5') {
      throw new Error(`an entry that is not a file: ${path} (type ${type})`);
    }
    offset = start + Math.ceil(size / BLOCK) * BLOCK;
  }
  return entries;
}
