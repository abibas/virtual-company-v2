import {
  FOLDERS_MAX,
  type FolderEntry,
  type FolderError,
  type FsList,
  type FsMkdir,
  type FsResult,
} from '@mwc/shared/runner-protocol';
import { childOf, type FolderScope, isWithin, parentOf, resolveFolder } from './paths.ts';

/**
 * The folder browser (S5.1d, docs/runner-protocol.md "Folders"): `fs.list` lists the folders in one folder of this
 * machine (dot-folders left out, sorted by name, at most `FOLDERS_MAX`, each marked when it holds `.git` or a
 * `CLAUDE.md`), and `fs.mkdir` makes one folder whose parent exists. Paths go through `paths.ts`; with a root (the
 * container's `/work`) the folder's real path, links followed, must stay inside the root's. Never a file's contents.
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
}

/** What the browser works with: the file system, the runner user's home and the only allowed root. */
export interface FolderHost extends FolderScope {
  readonly fs: FoldersFs;
}

/** The folder code of a file system error. */
function codeOf(error: unknown): FolderError {
  switch ((error as { code?: unknown } | null)?.code) {
    case 'ENOENT':
      return 'not_found';
    case 'ENOTDIR':
      return 'not_a_directory';
    case 'EACCES':
    case 'EPERM':
      return 'permission_denied';
    case 'EEXIST':
      return 'exists';
    default:
      return 'failed';
  }
}

/** A refusal of a frame: `<code>: <words>`. */
class Refusal extends Error {
  readonly code: FolderError;

  constructor(code: FolderError, words: string) {
    super(`${code}: ${words}`);
    this.code = code;
  }
}

const wordsOf = (error: unknown) => (error instanceof Error && error.message ? error.message : 'it failed');

/** Runs a file system call; its failure becomes a refusal naming `path`. */
async function attempt<T>(path: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    const code = codeOf(error);
    throw new Refusal(code, code === 'failed' ? `${path}: ${wordsOf(error)}` : path);
  }
}

/** The path the frame names, resolved, or a refusal. */
function resolve(host: FolderHost, input: string): string {
  const checked = resolveFolder(input, host);
  if (!checked.ok) throw new Refusal(checked.code, checked.words);
  return checked.path;
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
  const path = resolve(host, frame.path ?? host.root ?? host.home);
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
  const path = resolve(host, frame.path);
  const parent = parentOf(path, host.root);
  if (parent === null) throw new Refusal('exists', path);
  await folderAt(host, parent);
  await attempt(path, () => host.fs.mkdir(path));
  return { type: 'fs.result', cmdId: frame.cmdId, ok: true, path };
}

/** The answer to `fs.list` or `fs.mkdir` (`unsupported` without a host: a runner that does not browse); it never throws. */
export async function browse(host: FolderHost | undefined, frame: FsList | FsMkdir): Promise<FsResult> {
  if (host === undefined) {
    return {
      type: 'fs.result',
      cmdId: frame.cmdId,
      ok: false,
      error: 'unsupported: this runner does not browse folders',
    };
  }
  try {
    return await (frame.type === 'fs.list' ? list(host, frame) : mkdir(host, frame));
  } catch (error) {
    const message = error instanceof Refusal ? error.message : `failed: ${wordsOf(error)}`;
    return { type: 'fs.result', cmdId: frame.cmdId, ok: false, error: message.slice(0, 2000) };
  }
}
