import type { FolderError } from '@mwc/shared/runner-protocol';

/**
 * The folder browser's path rules (docs/runner-protocol.md, "Folders"), pure: `~` and `~/…` are the runner user's
 * home, every other path is absolute; `.` and `..` segments and repeated or trailing slashes are normalized away, and a
 * `..` that would climb above `/` is refused. With a root (`/work` in a container) the path must be the root or under
 * it.
 */

/** Where the runner's folders start: its user's home, and the only allowed root (null: the whole machine). */
export interface FolderScope {
  readonly home: string;
  readonly root: string | null;
}

/** A path the runner may use, or why not. */
export type PathCheck =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly code: FolderError; readonly words: string };

const refusal = (code: FolderError, words: string): PathCheck => ({ ok: false, code, words });

/** True when `path` is `root` or a path inside it (both normalized). */
export function isWithin(path: string, root: string): boolean {
  return root === '/' || path === root || path.startsWith(`${root}/`);
}

/** The normalized absolute path of `input` (`~` resolved with `home`), or why it is refused. */
export function resolveFolder(input: string, scope: FolderScope): PathCheck {
  if (input.includes('\0')) return refusal('invalid_path', 'a path has no NUL character');
  let raw = input;
  if (raw === '~' || raw.startsWith('~/')) raw = scope.home + raw.slice(1);
  if (!raw.startsWith('/')) return refusal('invalid_path', `${input} is not an absolute path`);
  const segments: string[] = [];
  for (const segment of raw.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment !== '..') segments.push(segment);
    else if (segments.pop() === undefined) return refusal('invalid_path', `${input} climbs above /`);
  }
  const path = `/${segments.join('/')}`;
  if (scope.root !== null && !isWithin(path, scope.root)) {
    return refusal('outside_volume', `${path} is outside ${scope.root}`);
  }
  return { ok: true, path };
}

/** The folder above `path`: null at `/` and at the root. */
export function parentOf(path: string, root: string | null): string | null {
  if (path === '/' || path === root) return null;
  return path.slice(0, path.lastIndexOf('/')) || '/';
}

/** `name` inside the folder `path`. */
export const childOf = (path: string, name: string): string =>
  path === '/' ? `/${name}` : `${path}/${name}`;
