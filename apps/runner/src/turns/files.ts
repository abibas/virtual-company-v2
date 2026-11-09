import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import type { PrivateFs } from './private-dir.ts';

/** The private folders' file operations on Node's own file system (`system/node.ts` hands them to the daemon). */
export function nodePrivateFs(): PrivateFs {
  return {
    isDirectory: (path) => {
      try {
        return statSync(path).isDirectory();
      } catch {
        return false;
      }
    },
    exists: (path) => existsSync(path),
    mkdir: (path) => {
      mkdirSync(path, { recursive: true, mode: 0o700 });
    },
    read: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return undefined;
      }
    },
    write: (path, text, mode) => {
      writeFileSync(path, text, { mode });
      // The mode of `writeFileSync` applies only to a new file.
      chmodSync(path, mode);
    },
    rename: (from, to) => renameSync(from, to),
    remove: (path) => rmSync(path, { force: true }),
  };
}
