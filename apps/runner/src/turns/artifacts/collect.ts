import { createHash } from 'node:crypto';
import { join, sep } from 'node:path';
import type { ArtifactSkipReason } from '@mwc/shared/enums';
import { ARTIFACT_LIMITS, artifactContentType, artifactParts, isArtifactPath } from '@mwc/shared/flows';
import type { SkippedArtifact, TurnArtifact, TurnArtifacts } from '@mwc/shared/runner-protocol';
import type { Log } from '../../system/log.ts';

/**
 * A task step's outputs (S5.3b, docs/runner-protocol.md "Artifacts"): before the turn's process starts, the runner makes
 * the folder its spec names under the agent's home folder (`TurnSpec.artifacts.dir`, e.g.
 * `tasks/T-12/artifacts/1-develop/round-1`) and notes what is there; when the process ends it collects the files that
 * are new or changed (size or time), at most `ARTIFACT_LIMITS.files` of at most 2 MB each and 10 MB together, text or
 * images only, and lists the rest as skipped with why. The folder must stay inside the home folder once links are
 * followed (else nothing is collected); links and hidden names inside it are passed over.
 */

/** A regular file under the folder: its path relative to it, its size and its last change. */
export interface ArtifactEntry {
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
}

/** The file operations a collection needs (`nodeArtifactFs`, `fs.ts`). */
export interface ArtifactFs {
  /** Makes the folder and its parents when missing; its real path, or undefined when it cannot be made. */
  ensure(dir: string): string | undefined;
  /** A folder's real path (links followed), or undefined. */
  realpath(path: string): string | undefined;
  /** The regular files under `dir` (no link followed, no hidden name), at most `max` of them, `depth` folders deep. */
  walk(dir: string, max: number, depth: number): ArtifactEntry[];
  /** A file's bytes, at most `max` of them (undefined when it cannot be read or is longer). */
  read(path: string, max: number): Uint8Array | undefined;
}

/** How many entries a walk looks at, and how deep. */
export const WALK_MAX = 500;
export const WALK_DEPTH = 6;

/** A file collected: its path, type, bytes and hash. */
export interface CollectedFile {
  readonly path: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

/** What a collection gives: the files, and the ones left out. */
export interface Collected {
  readonly files: readonly CollectedFile[];
  readonly skipped: readonly SkippedArtifact[];
}

const stamp = (entry: ArtifactEntry) => `${entry.size}:${entry.mtimeMs}`;

export class ArtifactCollector {
  readonly #fs: ArtifactFs;
  readonly #root: string;
  readonly #before: ReadonlyMap<string, string>;

  private constructor(fs: ArtifactFs, root: string, before: ReadonlyMap<string, string>) {
    this.#fs = fs;
    this.#root = root;
    this.#before = before;
  }

  /**
   * Makes the outputs folder and notes what is in it; undefined (logged) when it cannot be made or leads outside the home
   * folder, and the turn runs without a collection.
   */
  static open(fs: ArtifactFs, cwd: string, dir: string, log: Log): ArtifactCollector | undefined {
    const root = fs.ensure(join(cwd, dir));
    const home = fs.realpath(cwd);
    if (root === undefined || home === undefined || !(root === home || root.startsWith(`${home}${sep}`))) {
      log.warn('the outputs folder cannot be used; nothing is collected', { dir });
      return undefined;
    }
    const before = new Map(fs.walk(root, WALK_MAX, WALK_DEPTH).map((entry) => [entry.path, stamp(entry)]));
    return new ArtifactCollector(fs, root, before);
  }

  /** The files new or changed since `open`, in path order, within the limits; the rest skipped with why. */
  collect(): Collected {
    const changed = this.#fs
      .walk(this.#root, WALK_MAX, WALK_DEPTH)
      .filter((entry) => this.#before.get(entry.path) !== stamp(entry) && isArtifactPath(entry.path))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const files: CollectedFile[] = [];
    const skipped: SkippedArtifact[] = [];
    const skip = (entry: ArtifactEntry, reason: ArtifactSkipReason) => {
      if (skipped.length < ARTIFACT_LIMITS.skipped)
        skipped.push({ path: entry.path, size: entry.size, reason });
    };
    let total = 0;
    for (const entry of changed) {
      if (files.length >= ARTIFACT_LIMITS.files) skip(entry, 'too_many');
      else if (entry.size > ARTIFACT_LIMITS.fileBytes) skip(entry, 'too_large');
      else if (total + entry.size > ARTIFACT_LIMITS.totalBytes) skip(entry, 'total_limit');
      else {
        const bytes = this.#fs.read(join(this.#root, entry.path), ARTIFACT_LIMITS.fileBytes);
        const contentType = bytes && artifactContentType(entry.path, bytes);
        if (bytes === undefined || total + bytes.length > ARTIFACT_LIMITS.totalBytes)
          skip(entry, 'unreadable');
        else if (contentType === undefined) skip(entry, 'binary');
        else {
          total += bytes.length;
          const sha256 = createHash('sha256').update(bytes).digest('hex');
          files.push({ path: entry.path, contentType, bytes, sha256 });
        }
      }
    }
    return { files, skipped };
  }
}

/** The frames of a collection: each file's parts (`turn.artifact`), then what was collected and left out. */
export function artifactFrames(turnId: string, collected: Collected): (TurnArtifact | TurnArtifacts)[] {
  const frames: (TurnArtifact | TurnArtifacts)[] = [];
  collected.files.forEach((file, index) => {
    const parts = artifactParts(file.bytes.length);
    for (let part = 0; part < parts; part++) {
      const slice = file.bytes.subarray(
        part * ARTIFACT_LIMITS.partBytes,
        (part + 1) * ARTIFACT_LIMITS.partBytes,
      );
      frames.push({
        type: 'turn.artifact',
        turnId,
        index,
        path: file.path,
        contentType: file.contentType,
        size: file.bytes.length,
        sha256: file.sha256,
        part,
        parts,
        data: Buffer.from(slice).toString('base64'),
      });
    }
  });
  frames.push({
    type: 'turn.artifacts',
    turnId,
    files: collected.files.length,
    skipped: [...collected.skipped],
  });
  return frames;
}
