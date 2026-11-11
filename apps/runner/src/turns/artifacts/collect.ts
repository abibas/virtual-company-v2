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
 * followed (else nothing is collected); links and hidden names inside it are passed over. What was there before is
 * kept in the turn's run folder (`snapshot`), so a turn taken back after a runner restart still collects (S5.4). An
 * agent may attach one of its files at once (`task_attach {path}`, S6a: `attach`): the same rules, and once it was sent
 * it counts as there before, so the end does not send it again unless it changes (a runner that takes the turn back
 * after a restart has the snapshot of the start, and sends it again under the same name).
 */

/** What a collection noted before the turn: the folder and each file's size and time (a run folder keeps it). */
export interface ArtifactSnapshot {
  readonly root: string;
  readonly before: readonly (readonly [string, string])[];
}

/** A regular file under the folder: its path relative to it, its size and its last change. */
export interface ArtifactEntry {
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
}

/** What a path is, without following a link: a regular file, a link, or something else; its size and last change. */
export interface ArtifactStat {
  readonly kind: 'file' | 'link' | 'other';
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
  /** What a path is, no link followed; undefined when there is nothing there. */
  stat(path: string): ArtifactStat | undefined;
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

const stamp = (entry: Pick<ArtifactEntry, 'size' | 'mtimeMs'>) => `${entry.size}:${entry.mtimeMs}`;

/** A file an agent attaches (`attach`): the file to send, or why not, in words it can act on. */
export type Attached = { readonly file: CollectedFile; readonly stamp: string } | { readonly error: string };

const refused = (error: string): Attached => ({ error });

export class ArtifactCollector {
  readonly #fs: ArtifactFs;
  readonly #root: string;
  readonly #before: Map<string, string>;

  private constructor(fs: ArtifactFs, root: string, before: Map<string, string>) {
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

  /** The collector of a turn taken back after a restart, from what its run folder kept. */
  static restore(fs: ArtifactFs, snapshot: ArtifactSnapshot): ArtifactCollector {
    return new ArtifactCollector(fs, snapshot.root, new Map(snapshot.before));
  }

  /** What `open` noted, for the run folder. */
  snapshot(): ArtifactSnapshot {
    return { root: this.#root, before: [...this.#before] };
  }

  /**
   * One file of the folder an agent attaches now (S6a), by its path inside it: a plain path (no `.` or `..` part), a
   * regular file whose real path stays inside the folder (no link), at most 2 MB, text or an image; else why not.
   */
  attach(path: string): Attached {
    if (!isArtifactPath(path))
      return refused(
        `"${path}" is not a path inside your outputs folder (no "." or ".." parts, no leading "/").`,
      );
    const full = join(this.#root, path);
    const found = this.#fs.stat(full);
    if (found === undefined) return refused(`There is no file "${path}" in your outputs folder.`);
    if (found.kind === 'link')
      return refused(`"${path}" is a link: attach the file itself, inside your outputs folder.`);
    if (found.kind !== 'file') return refused(`"${path}" is not a file.`);
    if (this.#fs.realpath(full) !== full) return refused(`"${path}" is not in your outputs folder.`);
    if (found.size > ARTIFACT_LIMITS.fileBytes)
      return refused(`"${path}" is over the ${ARTIFACT_LIMITS.fileBytes / (1024 * 1024)} MB a file may be.`);
    const bytes = this.#fs.read(full, ARTIFACT_LIMITS.fileBytes);
    if (bytes === undefined) return refused(`"${path}" could not be read.`);
    const contentType = artifactContentType(path, bytes);
    if (contentType === undefined) return refused(`"${path}" is neither text nor an image.`);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    return { file: { path, contentType, bytes, sha256 }, stamp: stamp(found) };
  }

  /** An attached file was sent: the end's collection passes over it unless it changes (`stamp` is `attach`'s). */
  sent(path: string, sentStamp: string): void {
    this.#before.set(path, sentStamp);
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

/** One file's parts (`turn.artifact`), numbered `index` in the turn; an attached file's carry its call's id (S6a). */
export function fileFrames(
  turnId: string,
  index: number,
  file: CollectedFile,
  callId?: string,
): TurnArtifact[] {
  const parts = artifactParts(file.bytes.length);
  return Array.from({ length: parts }, (_, part) => ({
    type: 'turn.artifact',
    turnId,
    index,
    path: file.path,
    contentType: file.contentType,
    size: file.bytes.length,
    sha256: file.sha256,
    part,
    parts,
    data: Buffer.from(
      file.bytes.subarray(part * ARTIFACT_LIMITS.partBytes, (part + 1) * ARTIFACT_LIMITS.partBytes),
    ).toString('base64'),
    ...(callId === undefined ? {} : { callId }),
  }));
}

/** The frames of a collection: each file's parts (`turn.artifact`), then what was collected and left out. */
export function artifactFrames(turnId: string, collected: Collected): (TurnArtifact | TurnArtifacts)[] {
  const frames: (TurnArtifact | TurnArtifacts)[] = collected.files.flatMap((file, index) =>
    fileFrames(turnId, index, file),
  );
  frames.push({
    type: 'turn.artifacts',
    turnId,
    files: collected.files.length,
    skipped: [...collected.skipped],
  });
  return frames;
}
