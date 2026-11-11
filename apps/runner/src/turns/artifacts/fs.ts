import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
} from 'node:fs';
import { join } from 'node:path';
import type { ArtifactEntry, ArtifactFs } from './collect.ts';

/**
 * A step's outputs folder on Node's own file system (S5.3b, `system/node.ts` hands it to the daemon): the folder made
 * with its parents (0755, less the umask: the agent writes there), real paths, a walk that follows no link and passes
 * over hidden names, and a bounded read (one open, one size check, one read).
 */
export function nodeArtifactFs(): ArtifactFs {
  return {
    ensure: (dir) => {
      try {
        mkdirSync(dir, { recursive: true });
        return realpathSync(dir);
      } catch {
        return undefined;
      }
    },
    realpath: (path) => {
      try {
        return realpathSync(path);
      } catch {
        return undefined;
      }
    },
    walk: (dir, max, depth) => walk(dir, max, depth),
    read: (path, max) => {
      try {
        return readBounded(path, max);
      } catch {
        return undefined;
      }
    },
  };
}

/** The regular files under `root` (see `ArtifactFs.walk`), breadth first. */
function walk(root: string, max: number, depth: number): ArtifactEntry[] {
  const found: ArtifactEntry[] = [];
  let seen = 0;
  let level: string[] = [''];
  for (let d = 0; d <= depth && level.length > 0; d++) {
    const next: string[] = [];
    for (const folder of level) {
      let names: string[];
      try {
        names = readdirSync(join(root, folder)).sort();
      } catch {
        continue;
      }
      for (const name of names) {
        if (name.startsWith('.') || ++seen > max) continue;
        const path = folder === '' ? name : `${folder}/${name}`;
        try {
          const stat = lstatSync(join(root, path));
          if (stat.isFile()) found.push({ path, size: stat.size, mtimeMs: stat.mtimeMs });
          else if (stat.isDirectory()) next.push(path);
        } catch {
          // Gone since the listing: nothing to collect.
        }
      }
    }
    level = next;
  }
  return found;
}

/** At most `max` bytes of a regular file, or undefined when it is longer (or not a regular file); never via a link. */
function readBounded(path: string, max: number): Uint8Array | undefined {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > max) return undefined;
    const buffer = Buffer.alloc(stat.size);
    const read = readSync(fd, buffer, 0, stat.size, 0);
    return new Uint8Array(buffer.subarray(0, read));
  } finally {
    closeSync(fd);
  }
}
