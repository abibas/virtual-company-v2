import {
  FOLDERS_MAX,
  type FolderEntry,
  type FsList,
  type FsMkdir,
  type FsMkdirp,
  type FsResult,
} from '@mwc/shared/runner-protocol';
import { makeFolders } from './mkdirp.ts';
import { childOf, type FolderScope, isWithin, parentOf } from './paths.ts';
import { attempt, Refusal, resolvePath, wordsOf } from './refusal.ts';

/**
 * The folder browser (S5.1d, docs/runner-protocol.md "Folders"): `fs.list` lists the folders in one folder of this
 * machine (dot-folders left out, sorted by name, at most `FOLDERS_MAX`, each marked when it holds `.git` or a
 * `CLAUDE.md`), `fs.mkdir` makes one folder whose parent exists and `fs.mkdirp` a folder with its parents
 * (`mkdirp.ts`). Paths go through `paths.ts`; with a root (the container's `/work`) the folder's real path, links
 * followed, must stay inside the root's. Never a file's contents.
 */

/** One entry of a folder: its name, and whether it is a folder (a link to one counts). */
export interface DirEntry {
  readonly name: string;
  readonly directory: boolean;
}

/** The file system calls the browser makes (`files.ts`); failures throw Node's errors, with their `code`. */
export interface FoldersFs {
  /** True for a folder (links followed); throws ENOENT when nothing is there. */
  isDirectory(path: string): Promise<boolean>;
  realpath(path: string): Promise<string>;
  readdir(path: string): Promise<readonly DirEntry[]>;
  exists(path: string): Promise<boolean>;
  /** Makes one folder (0755); its parent must exist. */
  mkdir(path: string): Promise<void>;
  /** Makes a folder and its missing parents (each 0755); an existing folder is no error. */
  mkdirp(path: string): Promise<void>;
}

/** What the browser works with: the file system, the runner user's home and the only allowed root. */
export interface FolderHost extends FolderScope {
  readonly fs: FoldersFs;
}

/** Refuses a folder that is not one, and with a root a folder whose real path leaves it (a link out of the volume). */
async function folderAt(host: FolderHost, path: string): Promise<void> {
  if (!(await attempt(path, () => host.fs.isDirectory(path)))) {
    throw new Refusal('not_a_directory', path);
  }
  if (host.root === null) return;
  const [real, root] = await Promise.all([
    attempt(path, () => host.fs.realpath(path)),
    attempt(host.root, () => host.fs.realpath(host.root as string)),
  ]);
  if (!isWithin(real, root)) throw new Refusal('outside_volume', `${path} leads outside ${host.root}`);
}

/** By name, ignoring case and reading numbers as numbers; names in one folder differ, so a tie falls to their bytes. */
const byName = (a: string, b: string) =>
  a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true }) || (a < b ? -1 : 1);

async function entryOf(host: FolderHost, path: string, name: string): Promise<FolderEntry> {
  const folder = childOf(path, name);
  const [git, claudeMd] = await Promise.all([
    host.fs.exists(childOf(folder, '.git')),
    host.fs.exists(childOf(folder, 'CLAUDE.md')),
  ]);
  return { name, git, claudeMd };
}

async function list(host: FolderHost, frame: FsList): Promise<FsResult> {
  const path = resolvePath(host, frame.path ?? host.root ?? host.home);
  await folderAt(host, path);
  const names = (await attempt(path, () => host.fs.readdir(path)))
    .filter((entry) => entry.directory && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort(byName);
  const kept = names.slice(0, FOLDERS_MAX);
  const entries = await Promise.all(kept.map((name) => entryOf(host, path, name)));
  return {
    type: 'fs.result',
    cmdId: frame.cmdId,
    ok: true,
    path,
    parent: parentOf(path, host.root),
    entries,
    truncated: names.length > kept.length,
    home: host.home,
    root: host.root,
  };
}

async function mkdir(host: FolderHost, frame: FsMkdir): Promise<FsResult> {
  const path = resolvePath(host, frame.path);
  const parent = parentOf(path, host.root);
  if (parent === null) throw new Refusal('exists', path);
  await folderAt(host, parent);
  await attempt(path, () => host.fs.mkdir(path));
  return { type: 'fs.result', cmdId: frame.cmdId, ok: true, path };
}

/** The answer to a folder frame. */
async function answer(host: FolderHost, frame: FsList | FsMkdir | FsMkdirp): Promise<FsResult> {
  if (frame.type === 'fs.list') return list(host, frame);
  if (frame.type === 'fs.mkdir') return mkdir(host, frame);
  const made = await makeFolders(host, frame.path);
  return { type: 'fs.result', cmdId: frame.cmdId, ok: true, ...made };
}

/** The answer to a folder frame (`unsupported` without a host: a runner that does not browse); it never throws. */
export async function browse(
  host: FolderHost | undefined,
  frame: FsList | FsMkdir | FsMkdirp,
): Promise<FsResult> {
  if (host === undefined) {
    return {
      type: 'fs.result',
      cmdId: frame.cmdId,
      ok: false,
      error: 'unsupported: this runner does not browse folders',
    };
  }
  try {
    return await answer(host, frame);
  } catch (error) {
    const message = error instanceof Refusal ? error.message : `failed: ${wordsOf(error)}`;
    return { type: 'fs.result', cmdId: frame.cmdId, ok: false, error: message.slice(0, 2000) };
  }
}
