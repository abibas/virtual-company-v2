import { access, mkdir, readdir, realpath, stat } from 'node:fs/promises';
import type { DirEntry, FoldersFs } from './browse.ts';
import { childOf } from './paths.ts';

/** The folder browser's calls on Node's own file system (`system/node.ts` hands them to the daemon). */
export function nodeFoldersFs(): FoldersFs {
  const isDirectory = async (path: string) => (await stat(path)).isDirectory();
  /** A link counts when it leads to a folder; a broken one does not. */
  const linkedFolder = (path: string) => isDirectory(path).catch(() => false);
  return {
    isDirectory,
    realpath: (path) => realpath(path),
    readdir: async (path) => {
      const entries = await readdir(path, { withFileTypes: true });
      return Promise.all(
        entries.map(
          async (entry): Promise<DirEntry> => ({
            name: entry.name,
            directory:
              entry.isDirectory() ||
              (entry.isSymbolicLink() && (await linkedFolder(childOf(path, entry.name)))),
          }),
        ),
      );
    },
    exists: (path) =>
      access(path).then(
        () => true,
        () => false,
      ),
    mkdir: async (path) => {
      await mkdir(path, { mode: 0o755 });
    },
  };
}
