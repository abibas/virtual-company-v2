import {
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
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
    list: (dir) => {
      try {
        return readdirSync(dir);
      } catch {
        return [];
      }
    },
    tail: (path, bytes) => {
      try {
        return tailOf(path, bytes);
      } catch {
        return undefined;
      }
    },
  };
}

/** The last `bytes` bytes of a file as UTF-8, and its size: one open, one read, never the whole of a big file. */
function tailOf(path: string, bytes: number): { text: string; size: number } {
  const fd = openSync(path, 'r');
  try {
    const { size } = fstatSync(fd);
    const length = Math.min(size, bytes);
    const buffer = Buffer.alloc(length);
    const read = readSync(fd, buffer, 0, length, size - length);
    return { text: buffer.toString('utf8', 0, read), size };
  } finally {
    closeSync(fd);
  }
}
