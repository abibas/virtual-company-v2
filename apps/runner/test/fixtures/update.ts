/**
 * The self-update's test world: files in memory (`memoryFs`, with a failure the test asks for), and a server's downloads
 * (`fakeDownloads`): the bundle and a PTY archive (made with the build's own `tarGz`), each with its SHA-256 header,
 * every request recorded.
 */
import { createHash } from 'node:crypto';
import { RUNNER_SHA256_HEADER } from '@mwc/shared/runner-protocol';
import type { HostFs } from '../../src/install/host.ts';
import { tarGz } from '../../src/install/tar.ts';

export const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

type UpdateFs = Pick<HostFs, 'exists' | 'writeBytes' | 'rename' | 'remove' | 'mkdir'>;
type Op = 'writeBytes' | 'rename' | 'remove' | 'mkdir';

/** Files in memory by path, with their modes; folders are implied by the files under them, or made. */
export function memoryFs(seed: Record<string, string> = {}) {
  const files = new Map<string, { bytes: Uint8Array; mode: number }>();
  const dirs = new Set<string>();
  const ops: string[] = [];
  let failure: ((op: Op, path: string) => boolean) | undefined;
  for (const [path, text] of Object.entries(seed)) files.set(path, { bytes: Buffer.from(text), mode: 0o644 });
  const under = (path: string) => [...files.keys()].filter((key) => key.startsWith(`${path}/`));
  const check = (op: Op, path: string) => {
    ops.push(`${op} ${path}`);
    if (failure?.(op, path)) throw new Error(`EIO: ${op} ${path}`);
  };
  const fs: UpdateFs = {
    exists: (path) => files.has(path) || dirs.has(path) || under(path).length > 0,
    writeBytes: (path, bytes, mode) => {
      check('writeBytes', path);
      if (files.has(path)) throw new Error(`EEXIST: ${path}`);
      files.set(path, { bytes: Uint8Array.from(bytes), mode });
    },
    rename: (from, to) => {
      check('rename', from);
      if (files.has(from)) {
        files.set(to, files.get(from) as { bytes: Uint8Array; mode: number });
        files.delete(from);
        return;
      }
      const moved = under(from);
      if (moved.length === 0) throw new Error(`ENOENT: ${from}`);
      if (under(to).length > 0) throw new Error(`ENOTEMPTY: ${to}`);
      for (const key of moved) {
        files.set(`${to}${key.slice(from.length)}`, files.get(key) as { bytes: Uint8Array; mode: number });
        files.delete(key);
      }
    },
    remove: (path) => {
      check('remove', path);
      files.delete(path);
      for (const key of under(path)) files.delete(key);
    },
    mkdir: (path) => {
      check('mkdir', path);
      dirs.add(path);
    },
  };
  return {
    fs,
    ops,
    /** A file's text, or undefined. */
    text: (path: string) => {
      const file = files.get(path);
      return file === undefined ? undefined : Buffer.from(file.bytes).toString();
    },
    mode: (path: string) => files.get(path)?.mode,
    /** Every file's path, sorted. */
    paths: () => [...files.keys()].sort(),
    /** The next matching call throws (an I/O error). */
    failWhen: (match: (op: Op, path: string) => boolean) => {
      failure = match;
    },
  };
}

/** A PTY archive as the build packs it: `node_modules/@lydell/node-pty-<target>/…`, with `spawn-helper` executable. */
export function ptyArchive(target = 'linux-arm64', version = 'new'): Uint8Array {
  const dir = `node_modules/@lydell/node-pty-${target}`;
  return tarGz([
    { path: `${dir}/package.json`, mode: 0o644, body: Buffer.from(`{"version":"${version}"}`) },
    { path: `${dir}/prebuilds/spawn-helper`, mode: 0o755, body: Buffer.from('#!helper') },
  ]);
}

export interface Download {
  readonly status?: number;
  readonly body?: Uint8Array | string;
  /** The SHA-256 header: the body's by default; null sends none. */
  readonly sha?: string | null;
}

/** A server's downloads by path (`/api/runner/runner.mjs`, …); a path it does not have is a 404. Records each URL. */
export function fakeDownloads(paths: Record<string, Download>) {
  const urls: string[] = [];
  const fetch = async (url: string): Promise<Response> => {
    urls.push(url);
    const download = paths[new URL(url).pathname];
    if (download === undefined) return new Response('{}', { status: 404 });
    const body = download.body ?? '';
    const headers = new Headers();
    const hash = download.sha === undefined ? sha(body) : download.sha;
    if (hash !== null) headers.set(RUNNER_SHA256_HEADER, hash);
    return new Response(typeof body === 'string' ? body : Buffer.from(body), {
      status: download.status ?? 200,
      headers,
    });
  };
  return { fetch, urls };
}
