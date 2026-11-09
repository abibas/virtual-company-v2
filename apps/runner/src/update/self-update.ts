import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import {
  RUNNER_BUNDLE_PATH,
  RUNNER_MANIFEST_PATH,
  RUNNER_PTY_PATH,
  RUNNER_SHA256_HEADER,
  type RunnerUpdateError,
} from '@mwc/shared/runner-protocol';
import { httpBase } from '../install/enroll/enroll.ts';
import type { Host, HostFs } from '../install/host.ts';
import { RUNNER_MANIFEST_FILE } from '../system/version.ts';
import { type ServiceKind, sha256, type UpdateTarget } from './build.ts';
import { type UntarEntry, untarGz } from './untar.ts';

/**
 * A runner updating itself (docs/machines.md, "Updating a runner"): it downloads the bundle, its manifest and its
 * system's PTY archive from the server it is linked to (`GET /api/runner/runner.mjs`, `/api/runner/runner.json` and
 * `/api/runner/pty/<target>.tgz`, the files `install.sh` takes), checks each against its SHA-256 header, and only then
 * puts them next to the installed copy: the bundle and the manifest written to temporary files, the PTY unpacked in a
 * staging folder, the old `node_modules/` moved aside, the new one moved in, the old `runner.json` moved aside, the new
 * one moved in, then the temporary bundle renamed over `runner.mjs`. A failure at any step leaves the old copy as it
 * was. A server without a PTY for this system keeps the one there; one without a manifest leaves none (the runner then
 * says no build time). It trusts the server over its authenticated link and
 * checks SHA-256 only (the signed self-update is S8).
 */

/** How long each download may take. */
export const DOWNLOAD_TIMEOUT_MS = 120_000;

/** Why an update did not happen, with the protocol's code (`runner.update.result.error` is `<code>: <message>`). */
export class UpdateError extends Error {
  override readonly name = 'UpdateError';
  readonly code: RunnerUpdateError;

  constructor(code: RunnerUpdateError, message: string) {
    super(message);
    this.code = code;
  }
}

export interface SelfUpdate {
  readonly manager: ServiceKind;
  /** Puts the server's runner and PTY in place of this one's; the new build. Throws an `UpdateError`. */
  apply(serverUrl: string): Promise<{ readonly build: string; readonly pty: boolean }>;
}

export interface SelfUpdateDeps {
  readonly target: UpdateTarget;
  readonly fetch: Host['fetch'];
  readonly fs: Pick<HostFs, 'exists' | 'writeBytes' | 'rename' | 'remove' | 'mkdir'>;
  /** A short random tag for the temporary names. */
  readonly tag?: () => string;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A file from the server with its SHA-256 checked; undefined for a 404 when `optional`. */
async function download(
  deps: SelfUpdateDeps,
  url: string,
  what: string,
  optional = false,
): Promise<Uint8Array | undefined> {
  let res: Response;
  let body: Uint8Array;
  try {
    res = await deps.fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (res.status === 404 && optional) return undefined;
    if (!res.ok) throw new Error(`the server answered ${res.status}`);
    body = new Uint8Array(await res.arrayBuffer());
  } catch (error) {
    throw new UpdateError('download_failed', `cannot download ${what} from ${url}: ${messageOf(error)}`);
  }
  const expected = res.headers.get(RUNNER_SHA256_HEADER);
  if (!expected) throw new UpdateError('hash_mismatch', `the server sent no SHA-256 for ${what}`);
  const actual = sha256(body);
  if (actual !== expected) {
    throw new UpdateError(
      'hash_mismatch',
      `${what} does not match its SHA-256 (${actual}, expected ${expected})`,
    );
  }
  return body;
}

/** The PTY's files, every one under `node_modules/` (as the build lays it out). */
function ptyFiles(archive: Uint8Array): UntarEntry[] {
  let files: UntarEntry[];
  try {
    files = untarGz(archive);
  } catch (error) {
    throw new UpdateError('download_failed', `cannot read the terminal's archive: ${messageOf(error)}`);
  }
  if (files.length === 0 || files.some((file) => !file.path.startsWith('node_modules/'))) {
    throw new UpdateError('download_failed', "the terminal's archive is not laid out as node_modules/");
  }
  return files;
}

/** Removes what is left over, quietly: a failure here never undoes an update. */
function tidy(fs: SelfUpdateDeps['fs'], ...paths: string[]): void {
  for (const path of paths) {
    try {
      fs.remove(path);
    } catch {
      // Left for the next update or install.
    }
  }
}

/** What an update puts in place: the bundle, its manifest (none from a server without one) and the PTY's files. */
interface NewFiles {
  readonly bundle: Uint8Array;
  readonly manifest: Uint8Array | undefined;
  readonly pty: UntarEntry[] | undefined;
}

/** Writes the new files beside the installed copy, then swaps them in; the old copy stays on any failure. */
function putInPlace(deps: SelfUpdateDeps, { bundle, manifest, pty }: NewFiles): void {
  const { fs, target } = deps;
  const dir = dirname(target.bundle);
  const tag = (deps.tag ?? (() => randomBytes(6).toString('hex')))();
  const tmp = join(dir, `.runner.${tag}.tmp`);
  const tmpManifest = join(dir, `.runner-json.${tag}.tmp`);
  const staging = join(dir, `.update.${tag}`);
  const modules = join(dir, 'node_modules');
  const old = join(dir, `.node_modules.${tag}.old`);
  const manifestPath = join(dir, RUNNER_MANIFEST_FILE);
  const oldManifest = join(dir, `.runner-json.${tag}.old`);
  const failed = (error: unknown): never => {
    tidy(fs, tmp, tmpManifest, staging);
    throw new UpdateError('write_failed', `cannot put the new runner in ${dir}: ${messageOf(error)}`);
  };
  try {
    fs.writeBytes(tmp, bundle, 0o644);
    if (manifest !== undefined) fs.writeBytes(tmpManifest, manifest, 0o644);
    for (const file of pty ?? []) {
      const path = join(staging, file.path);
      fs.mkdir(dirname(path), 0o755);
      fs.writeBytes(path, file.body, file.mode || 0o644);
    }
  } catch (error) {
    failed(error);
  }
  let movedOld = false;
  let movedNew = false;
  let movedOldManifest = false;
  let movedNewManifest = false;
  try {
    if (pty !== undefined) {
      if (fs.exists(modules)) {
        fs.rename(modules, old);
        movedOld = true;
      }
      fs.rename(join(staging, 'node_modules'), modules);
      movedNew = true;
    }
    if (fs.exists(manifestPath)) {
      fs.rename(manifestPath, oldManifest);
      movedOldManifest = true;
    }
    if (manifest !== undefined) {
      fs.rename(tmpManifest, manifestPath);
      movedNewManifest = true;
    }
    fs.rename(tmp, target.bundle);
  } catch (error) {
    if (movedNew) tidy(fs, modules);
    if (movedNewManifest) tidy(fs, manifestPath);
    try {
      if (movedOld) fs.rename(old, modules);
      if (movedOldManifest) fs.rename(oldManifest, manifestPath);
    } catch {
      // The old PTY or manifest stays aside; the next install puts one in place.
    }
    failed(error);
  }
  tidy(fs, staging, old, oldManifest);
}

/** The self-update of an installed runner (`build.ts`'s `updateTarget`). */
export function selfUpdater(deps: SelfUpdateDeps): SelfUpdate {
  const { target } = deps;
  return {
    manager: target.manager,
    async apply(serverUrl) {
      const base = httpBase(serverUrl);
      const bundle = (await download(deps, `${base}${RUNNER_BUNDLE_PATH}`, 'the runner')) as Uint8Array;
      const manifest = await download(deps, `${base}${RUNNER_MANIFEST_PATH}`, "the runner's manifest", true);
      const ptyUrl = target.pty === undefined ? undefined : `${base}${RUNNER_PTY_PATH}/${target.pty}.tgz`;
      const archive =
        ptyUrl === undefined ? undefined : await download(deps, ptyUrl, "the terminal's PTY", true);
      const pty = archive === undefined ? undefined : ptyFiles(archive);
      putInPlace(deps, { bundle, manifest, pty });
      return { build: sha256(bundle), pty: pty !== undefined };
    },
  };
}
