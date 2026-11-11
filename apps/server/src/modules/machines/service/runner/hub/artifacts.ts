import { createHash } from 'node:crypto';
import { ARTIFACT_LIMITS, artifactContentType, artifactParts } from '@mwc/shared/flows';
import type { TurnArtifact } from '@mwc/shared/runner-protocol';

/**
 * A turn's collected files as they come over the link (S5.3b, docs/runner-protocol.md "Artifacts"): each file's parts
 * (`turn.artifact`) are put together in memory, and a file whose parts are all there, whose length and SHA-256 match
 * what every part said, and whose bytes are text or an image (told again here, never the runner's word) is handed on
 * whole. A part that disagrees with the file's earlier parts, comes twice, or would take the turn past its total is
 * dropped with the whole file. Memory only, at most the turn's total (10 MB) at a time; what is left when the turn ends
 * is dropped.
 */

/** A file put together, checked and typed: what the turn's sink gets. */
export interface CollectedArtifact {
  readonly path: string;
  readonly contentType: string;
  readonly size: number;
  readonly sha256: string;
  readonly bytes: Uint8Array;
}

/** Why a file was dropped (logged by the hub, by turn and path). */
export type ArtifactDrop = 'mismatch' | 'over_total' | 'hash_mismatch' | 'binary';

interface Pending {
  readonly first: TurnArtifact;
  readonly parts: (Uint8Array | undefined)[];
  received: number;
}

const sameFile = (a: TurnArtifact, b: TurnArtifact) =>
  a.path === b.path && a.size === b.size && a.sha256 === b.sha256 && a.parts === b.parts;

/** One turn's files in the making. */
export function artifactAssembler() {
  const pending = new Map<number, Pending>();
  const dropped = new Set<number>();
  let total = 0;
  const drop = (index: number, why: ArtifactDrop) => {
    const had = pending.get(index);
    if (had) total -= had.parts.reduce((sum, part) => sum + (part?.length ?? 0), 0);
    pending.delete(index);
    dropped.add(index);
    return { dropped: why } as const;
  };
  return {
    /** One part: the whole file once it is complete and checked, a drop with why, or undefined while parts are due. */
    part(frame: TurnArtifact): CollectedArtifact | { readonly dropped: ArtifactDrop } | undefined {
      if (dropped.has(frame.index)) return undefined;
      const had = pending.get(frame.index);
      const bytes = new Uint8Array(Buffer.from(frame.data, 'base64'));
      const last = frame.part === frame.parts - 1;
      const expected = last
        ? frame.size - (frame.parts - 1) * ARTIFACT_LIMITS.partBytes
        : ARTIFACT_LIMITS.partBytes;
      const fits =
        frame.parts === artifactParts(frame.size) &&
        frame.part < frame.parts &&
        bytes.length === expected &&
        (had === undefined || (sameFile(had.first, frame) && had.parts[frame.part] === undefined));
      if (!fits) return drop(frame.index, 'mismatch');
      if (total + bytes.length > ARTIFACT_LIMITS.totalBytes) return drop(frame.index, 'over_total');
      const entry = had ?? { first: frame, parts: new Array(frame.parts).fill(undefined), received: 0 };
      entry.parts[frame.part] = bytes;
      entry.received += 1;
      total += bytes.length;
      pending.set(frame.index, entry);
      if (entry.received < frame.parts) return undefined;
      const whole = new Uint8Array(Buffer.concat(entry.parts as Uint8Array[]));
      const sha256 = createHash('sha256').update(whole).digest('hex');
      if (sha256 !== frame.sha256) return drop(frame.index, 'hash_mismatch');
      const contentType = artifactContentType(frame.path, whole);
      if (contentType === undefined) return drop(frame.index, 'binary');
      pending.delete(frame.index);
      return { path: frame.path, contentType, size: whole.length, sha256, bytes: whole };
    },
    /** How many files are still waiting for parts (dropped at the turn's end). */
    get waiting(): number {
      return pending.size;
    },
  };
}

export type ArtifactAssembler = ReturnType<typeof artifactAssembler>;
