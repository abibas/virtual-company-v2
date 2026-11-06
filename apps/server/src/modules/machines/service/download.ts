import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * The runner a machine downloads (`GET /api/runner/runner.mjs`): the bundle `pnpm --filter @mwc/runner build` makes,
 * read when asked (a rebuild is served at once) with its SHA-256, which `install.sh` checks before it runs it.
 */

/** The repository's bundle, apps/runner/dist/runner.mjs; the server image copies it to the same place. */
export const DEFAULT_RUNNER_BUNDLE = fileURLToPath(
  new URL('../../../../../runner/dist/runner.mjs', import.meta.url),
);

export type RunnerBundle =
  | { readonly ok: true; readonly body: Uint8Array<ArrayBuffer>; readonly sha256: string }
  | { readonly ok: false };

/** The bundle at `path` and its SHA-256, or not ok when it is not built. */
export async function readRunnerBundle(path: string): Promise<RunnerBundle> {
  let body: Uint8Array<ArrayBuffer>;
  try {
    body = new Uint8Array(await readFile(path));
  } catch {
    return { ok: false };
  }
  return { ok: true, body, sha256: createHash('sha256').update(body).digest('hex') };
}
