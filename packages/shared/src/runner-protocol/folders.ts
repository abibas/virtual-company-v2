import { z } from 'zod';
import { ErrorText, frame, protocolObject, Uuid } from './common.ts';
import { MachinePath } from './run-spec.ts';

/**
 * The folder browser (S5.1d, docs/machines.md "The folder browser"): the server asks a runner for the folders in one
 * folder of its machine (`fs.list`) or to make one folder (`fs.mkdir`), and the runner answers `fs.result` (instead of
 * `cmd.ack`). Folders only, never a file's contents. Paths are absolute (`/…`, or `~/…` for the runner user's home); the
 * runner normalizes them and refuses a relative path and a `..` that climbs above `/`. Inside a container every path
 * stays under its work volume, `/work` (`outside_volume` otherwise). A runner that says `caps.folders` knows these frames;
 * an older one acks them as commands it does not know.
 */

/** The work volume of a runner in a container: its only allowed root, where agents' home folders live. */
export const CONTAINER_WORK_ROOT = '/work';

/** The most folders one `fs.result` lists; past it the list is cut and says `truncated`. */
export const FOLDERS_MAX = 500;

/** How long the server waits for a runner's `fs.result`. */
export const FOLDERS_TIMEOUT_MS = 10_000;

/**
 * Why a runner did not list or make a folder, the code before `: ` in `fs.result.error`: no such folder (or, for
 * `fs.mkdir`, no such parent), a file where a folder was asked, the runner's user may not, a path outside the container's
 * work volume, something already at that path (`fs.mkdir`), a path that is not absolute or climbs above `/`, a runner
 * that does not browse folders, or any other failure of the file system.
 */
export const FOLDER_ERRORS = [
  'not_found',
  'not_a_directory',
  'permission_denied',
  'outside_volume',
  'exists',
  'invalid_path',
  'unsupported',
  'failed',
] as const;
export type FolderError = (typeof FOLDER_ERRORS)[number];

/** An absolute path as the runner resolved it. */
export const ResolvedPath = z.string().min(1).max(4096).startsWith('/');

/** A folder's name: one path segment. */
export const FolderName = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[^/\0]+$/, 'one path segment');

/** Server to runner: the folders in `path`, or in the default start (the runner user's home, `/work` in a container). */
export const FsList = frame('fs.list', {
  cmdId: Uuid,
  path: MachinePath.nullable(),
});
export type FsList = z.infer<typeof FsList>;

/** Server to runner: make the folder `path` (0755); its parent must exist. */
export const FsMkdir = frame('fs.mkdir', {
  cmdId: Uuid,
  path: MachinePath,
});
export type FsMkdir = z.infer<typeof FsMkdir>;

/** A folder in a listing, with whether it is a git checkout (`.git` in it) and has a `CLAUDE.md`. */
export const FolderEntry = protocolObject({
  name: FolderName,
  git: z.boolean(),
  claudeMd: z.boolean(),
});
export type FolderEntry = z.infer<typeof FolderEntry>;

/**
 * Runner to server, the answer to `fs.list` and `fs.mkdir`. `ok` with the resolved `path`; for a listing also its
 * `parent` (null at `/` and at the container's root), its folders (sorted by name, dot-folders left out, at most
 * `FOLDERS_MAX`, `truncated` past it), the runner user's `home` and the only allowed `root` (`/work` in a container, else
 * null). Otherwise why not, as `<code>: <words>`.
 */
export const FsResult = frame('fs.result', {
  cmdId: Uuid,
  ok: z.boolean(),
  error: ErrorText.optional(),
  path: ResolvedPath.optional(),
  parent: ResolvedPath.nullable().optional(),
  entries: z.array(FolderEntry).max(FOLDERS_MAX).optional(),
  truncated: z.boolean().optional(),
  home: ResolvedPath.optional(),
  root: ResolvedPath.nullable().optional(),
});
export type FsResult = z.infer<typeof FsResult>;

/** The code of an `fs.result` error (`not_found: /x` is `not_found`); `failed` for any other text. */
export function folderErrorCode(error: string | undefined): FolderError {
  const code = error?.split(':', 1)[0];
  return FOLDER_ERRORS.find((known) => known === code) ?? 'failed';
}

/** The folder frames the server sends, and the one a runner answers with. */
export const FOLDER_SERVER_FRAMES = [FsList, FsMkdir] as const;
export const FOLDER_RUNNER_FRAMES = [FsResult] as const;
