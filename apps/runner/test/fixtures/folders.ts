import type { FoldersFs } from '../../src/folders/browse.ts';

/** A file system error with Node's `code`. */
export const fsError = (code: string, path: string) => Object.assign(new Error(`${code}: ${path}`), { code });

export interface FakeTree {
  /** The folders there are. */
  readonly dirs: Set<string>;
  /** The files there are. */
  readonly files: Set<string>;
  /** Where a folder really is (a link), by path. */
  readonly real: Map<string, string>;
  /** Paths the runner's user may not open (EACCES). */
  readonly denied: Set<string>;
  /** Paths whose call fails with EIO. */
  readonly broken: Set<string>;
  /** The folders `mkdir` and `mkdirp` made, in order. */
  readonly made: string[];
}

const parentOf = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/';

/** A file system of folders and files in memory, for the folder browser. */
export function fakeFoldersFs(dirs: readonly string[], files: readonly string[] = []) {
  const tree: FakeTree = {
    dirs: new Set(dirs),
    files: new Set(files),
    real: new Map(),
    denied: new Set(),
    broken: new Set(),
    made: [],
  };
  const check = (path: string) => {
    if (tree.denied.has(path)) throw fsError('EACCES', path);
    if (tree.broken.has(path)) throw fsError('EIO', path);
  };
  /** The path with its link (the longest one it starts with) replaced by where the link leads. */
  const linked = (path: string) => {
    const link = [...tree.real.keys()]
      .filter((from) => path === from || path.startsWith(`${from}/`))
      .sort((a, b) => b.length - a.length)[0];
    return link === undefined ? path : `${tree.real.get(link)}${path.slice(link.length)}`;
  };
  const there = (path: string) => tree.dirs.has(path) || tree.files.has(path);
  /** A file on the way to `path` (ENOTDIR), as Node's calls find it. */
  const fileOnTheWay = (path: string) => {
    for (let at = parentOf(path); at !== '/'; at = parentOf(at)) {
      if (tree.files.has(at)) throw fsError('ENOTDIR', path);
    }
  };
  const fs: FoldersFs = {
    isDirectory: async (path) => {
      check(path);
      if (tree.dirs.has(path)) return true;
      if (tree.files.has(path)) return false;
      throw fsError('ENOENT', path);
    },
    realpath: async (path) => {
      check(path);
      fileOnTheWay(path);
      const real = linked(path);
      if (!there(real) && !there(path)) throw fsError('ENOENT', path);
      return real;
    },
    readdir: async (path) => {
      check(path);
      const prefix = path === '/' ? '/' : `${path}/`;
      const children = (set: Set<string>, directory: boolean) =>
        [...set]
          .filter((p) => p.startsWith(prefix) && p !== path && !p.slice(prefix.length).includes('/'))
          .map((p) => ({ name: p.slice(prefix.length), directory }));
      return [...children(tree.dirs, true), ...children(tree.files, false)];
    },
    exists: async (path) => tree.dirs.has(path) || tree.files.has(path),
    mkdir: async (path) => {
      check(path);
      if (tree.dirs.has(path) || tree.files.has(path)) throw fsError('EEXIST', path);
      if (!tree.dirs.has(parentOf(path))) throw fsError('ENOENT', path);
      tree.dirs.add(path);
      tree.made.push(path);
    },
    mkdirp: async (path) => {
      check(path);
      fileOnTheWay(path);
      if (tree.files.has(path)) throw fsError('EEXIST', path);
      const missing: string[] = [];
      for (let at = path; !tree.dirs.has(at); at = parentOf(at)) missing.unshift(at);
      for (const folder of missing) {
        tree.dirs.add(folder);
        tree.made.push(folder);
      }
    },
  };
  return { fs, tree };
}
