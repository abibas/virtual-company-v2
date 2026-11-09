import { gzipSync } from 'node:zlib';

/**
 * A gzipped tar archive (POSIX ustar), written in memory: how the build packs the terminal's PTY for each system
 * (`build.ts`), which the installer unpacks with the machine's own `tar -xzf` (macOS's bsdtar and GNU tar both read it).
 * Regular files only, owned by uid 0, with their modes kept (node-pty's `spawn-helper` stays executable) and one fixed
 * time, so the same files give the same archive. Not part of the runner bundle.
 */

export interface TarEntry {
  /** The path inside the archive, with `/`, relative. */
  readonly path: string;
  readonly mode: number;
  readonly body: Uint8Array;
}

const BLOCK = 512;

/** The files' time, as npm's own tarballs have it (1985-10-26), so archives of the same files are the same bytes. */
export const TAR_MTIME = 499_162_500;

/** A number as a NUL-terminated octal field of `length` bytes. */
const octal = (value: number, length: number) => `${value.toString(8).padStart(length - 1, '0')}\0`;

/** ustar's name (up to 100 bytes) and prefix (up to 155), split at a `/`; throws when the path cannot fit. */
export function splitPath(path: string): { readonly prefix: string; readonly name: string } {
  if (Buffer.byteLength(path) <= 100) return { prefix: '', name: path };
  for (let slash = path.indexOf('/'); slash !== -1; slash = path.indexOf('/', slash + 1)) {
    const prefix = path.slice(0, slash);
    const name = path.slice(slash + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { prefix, name };
  }
  throw new Error(`A path too long for a tar archive: ${path}`);
}

function header(entry: TarEntry): Buffer {
  const block = Buffer.alloc(BLOCK);
  const { prefix, name } = splitPath(entry.path);
  block.write(name, 0, 100);
  block.write(octal(entry.mode & 0o7777, 8), 100);
  block.write(octal(0, 8), 108);
  block.write(octal(0, 8), 116);
  block.write(octal(entry.body.byteLength, 12), 124);
  block.write(octal(TAR_MTIME, 12), 136);
  block.write(' '.repeat(8), 148);
  block.write('0', 156);
  block.write('ustar\0', 257);
  block.write('00', 263);
  block.write(prefix, 345, 155);
  const sum = block.reduce((total, byte) => total + byte, 0);
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return block;
}

/** The archive of `entries`, in their order, gzipped. */
export function tarGz(entries: readonly TarEntry[]): Buffer {
  const parts: Uint8Array[] = [];
  for (const entry of entries) {
    parts.push(header(entry), entry.body);
    const rest = entry.body.byteLength % BLOCK;
    if (rest !== 0) parts.push(Buffer.alloc(BLOCK - rest));
  }
  parts.push(Buffer.alloc(2 * BLOCK));
  return gzipSync(Buffer.concat(parts));
}
