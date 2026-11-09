import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunnerPtyTarget } from '@mwc/shared/runner-protocol';

/**
 * The runner a machine downloads (`GET /api/runner/runner.mjs`): the bundle `pnpm --filter @mwc/runner build` makes,
 * read when asked (a rebuild is served at once) with its SHA-256, which `install.sh` checks before it runs it; and the
 * terminal's PTY for its system (`GET /api/runner/pty/<target>.tgz`), which the same build packs beside the bundle
 * (`dist/pty/<target>.tgz`) and `install.sh` checks the same way. The bundle's SHA-256 is also the build a current
 * runner says in its hello (`servedBuild`).
 */

/** The repository's bundle, apps/runner/dist/runner.mjs; the server image copies it to the same place. */
export const DEFAULT_RUNNER_BUNDLE = fileURLToPath(
  new URL('../../../../../runner/dist/runner.mjs', import.meta.url),
);

export type RunnerBundle =
  | { readonly ok: true; readonly body: Uint8Array<ArrayBuffer>; readonly sha256: string }
  | { readonly ok: false };

/** The PTY archive of a system, beside the bundle at `bundlePath`. */
export const ptyArchivePath = (bundlePath: string, target: RunnerPtyTarget): string =>
  join(dirname(bundlePath), 'pty', `${target}.tgz`);

/** The file (the bundle or a PTY archive) at `path` and its SHA-256, or not ok when it is not built. */
export async function readRunnerBundle(path: string): Promise<RunnerBundle> {
  let body: Uint8Array<ArrayBuffer>;
  try {
    body = new Uint8Array(await readFile(path));
  } catch {
    return { ok: false };
  }
  return { ok: true, body, sha256: createHash('sha256').update(body).digest('hex') };
}

/** The builds already hashed, by path, with the file's time and size then. */
const builds = new Map<
  string,
  { readonly mtimeMs: number; readonly size: number; readonly sha256: string }
>();

/**
 * The build this server hands out: the SHA-256 of the bundle at `path`, hashed again only when the file's time or size
 * changed (a rebuild); null while it is not built.
 */
export async function servedBuild(path: string): Promise<string | null> {
  let info: { readonly mtimeMs: number; readonly size: number };
  try {
    info = await stat(path);
  } catch {
    return null;
  }
  const known = builds.get(path);
  if (known !== undefined && known.mtimeMs === info.mtimeMs && known.size === info.size) return known.sha256;
  const bundle = await readRunnerBundle(path);
  if (!bundle.ok) return null;
  builds.set(path, { mtimeMs: info.mtimeMs, size: info.size, sha256: bundle.sha256 });
  return bundle.sha256;
}
