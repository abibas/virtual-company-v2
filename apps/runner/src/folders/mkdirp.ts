import type { Log } from '../system/log.ts';
import { childOf, type FolderScope, isWithin, parentOf } from './paths.ts';
import { attempt, codeOf, Refusal, refusalOf, resolvePath } from './refusal.ts';

/**
 * `fs.mkdirp` (docs/runner-protocol.md, "Folders"): a folder and its missing parents, `mkdir -p`, only inside the
 * runner's allowed root: the container's work volume, else the runner user's home. Never above it, and never through a
 * link that leads out of it: the real path of the nearest folder that exists (links followed) must stay inside the
 * root's real path, and the missing folders are made under that real path. An existing folder is no error. A turn of a
 * container runner uses it too, for an agent's home folder that is not there yet (`turns.ts`).
 */

/** The calls the folder maker makes (`files.ts`); failures throw Node's errors, with their `code`. */
export interface MakerFs {
  isDirectory(path: string): Promise<boolean>;
  realpath(path: string): Promise<string>;
  /** Makes a folder and its missing parents (each 0755). */
  mkdirp(path: string): Promise<void>;
}

/** What the folder maker works with: the file system, the runner user's home and the container's root. */
export interface FolderMaker extends FolderScope {
  readonly fs: MakerFs;
}

/** A folder made, or found there. */
export interface MadeFolder {
  /** The folder, resolved (as asked, not its real path). */
  readonly path: string;
  readonly created: boolean;
}

/** The only folder `fs.mkdirp` makes folders in: the container's root, else the runner user's home. */
export const makeRootOf = (scope: FolderScope): string => scope.root ?? scope.home;

/** The nearest folder of `path` that exists, its real path, and the names below it still to make. */
async function nearest(
  fs: MakerFs,
  path: string,
  root: string,
): Promise<{ readonly at: string; readonly real: string; readonly missing: readonly string[] }> {
  const missing: string[] = [];
  let at = path;
  for (;;) {
    try {
      return { at, real: await fs.realpath(at), missing };
    } catch (error) {
      if (codeOf(error) !== 'not_found' || at === root) throw refusalOf(at, error);
    }
    missing.unshift(at.slice(at.lastIndexOf('/') + 1));
    at = parentOf(at, root) as string;
  }
}

/** Makes `input` and its missing parents inside the allowed root, or throws a `Refusal`. */
export async function makeFolders(maker: FolderMaker, input: string): Promise<MadeFolder> {
  const path = resolvePath(maker, input);
  const root = makeRootOf(maker);
  const outside = maker.root === null ? 'outside_roots' : 'outside_volume';
  if (!isWithin(path, root)) throw new Refusal(outside, `${path} is outside ${root}`);
  const { fs } = maker;
  const realRoot = await attempt(root, () => fs.realpath(root));
  const found = await nearest(fs, path, root);
  if (!isWithin(found.real, realRoot)) throw new Refusal(outside, `${found.at} leads outside ${root}`);
  if (!(await attempt(found.at, () => fs.isDirectory(found.real))))
    throw new Refusal('not_a_directory', found.at);
  if (found.missing.length === 0) return { path, created: false };
  const target = found.missing.reduce(childOf, found.real);
  await attempt(path, () => fs.mkdirp(target));
  return { path, created: true };
}

/**
 * A container runner's maker of agents' home folders for turns (`HarnessHost.makeHome`): a missing home under the work
 * volume is made before the turn starts; true once the folder is there. It never throws: a refusal is logged, and the
 * turn is then refused as `home_missing`.
 */
export function homeMaker(maker: FolderMaker, log: Log): (path: string) => Promise<boolean> {
  return async (path) => {
    try {
      const made = await makeFolders(maker, path);
      if (made.created) log.info("made the agent's home folder", { path: made.path });
      return true;
    } catch (error) {
      log.warn("the agent's home folder could not be made", {
        path,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  };
}
