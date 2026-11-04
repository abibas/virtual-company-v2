import { isBinary, type ScanDeps } from '../banned.ts';
import type { StructureRules } from './rules.ts';

/** The repository as the structure rules see it. */
export interface RepoTree {
  /** Every file git tracks or would track (untracked files that are not ignored), sorted. */
  readonly paths: readonly string[];
  /** A file's text, or undefined when it is binary or gone from the working tree. */
  text(path: string): string | undefined;
}

/** One broken rule: where (a file, and a line when there is one) and why. */
export interface Violation {
  readonly path: string;
  readonly line?: number;
  /** The rule's short name, e.g. `size` or `tests`. */
  readonly rule: string;
  readonly message: string;
}

/** The tree behind a file listing (git's, in `mwc check`); each file is read at most once. */
export function repoTree(deps: ScanDeps): RepoTree {
  const texts = new Map<string, string | undefined>();
  return {
    paths: [...new Set(deps.listFiles())].sort(),
    text(path) {
      if (!texts.has(path)) {
        const content = deps.readFile(path);
        texts.set(
          path,
          content === undefined || isBinary(content) ? undefined : Buffer.from(content).toString('utf8'),
        );
      }
      return texts.get(path);
    },
  };
}

/** Lines in a text: a final newline does not start another line, and an empty file has none. */
export function lineCount(text: string): number {
  if (text === '') return 0;
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

/** The workspace package a path is in (`packages/db`) and the path inside it, or undefined. */
export function packageOf(path: string, rules: StructureRules): { pkg: string; inner: string } | undefined {
  const [group, name, ...rest] = path.split('/');
  if (group === undefined || name === undefined || rest.length === 0) return undefined;
  if (!rules.workspaceGroups.includes(group)) return undefined;
  return { pkg: `${group}/${name}`, inner: rest.join('/') };
}

/** True when `path` is the file `entry`, or inside the folder `entry` (ending in `/`). */
export function matches(path: string, entry: string): boolean {
  return entry.endsWith('/') ? path.startsWith(entry) : path === entry;
}

/** A path's first segment as an entry: `name/` for a folder, `name` for a file. */
export function firstEntry(path: string): string {
  const slash = path.indexOf('/');
  return slash < 0 ? path : path.slice(0, slash + 1);
}
