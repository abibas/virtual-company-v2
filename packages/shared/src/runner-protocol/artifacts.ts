import { z } from 'zod';
import {
  ARTIFACT_LIMITS,
  ARTIFACT_PARTS_MAX,
  ArtifactPath,
  ArtifactSkipReason,
  Sha256Hex,
} from '../flows.ts';
import { frame, protocolObject, Uuid } from './common.ts';
import { base64Bytes } from './terminal.ts';

/**
 * A task step's artifacts (S5.3b, docs/runner-protocol.md "Artifacts"): when a turn whose spec names an outputs folder
 * (`TurnSpec.artifacts`) ends, the runner sends each new or changed file of that folder in parts (`turn.artifact`, at
 * most `ARTIFACT_LIMITS.partBytes` each, so every frame fits the 256 KB limit), then what it collected and what it left
 * out (`turn.artifacts`), then `turn.end`. Optional both ways: a runner older than it sends neither, and a server older
 * than it ignores both as unknown frames.
 */

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** One part of a file's bytes as padded base64: at most `ARTIFACT_LIMITS.partBytes` bytes (an empty file's one part is empty). */
export const ArtifactData = z
  .string()
  .max(Math.ceil(ARTIFACT_LIMITS.partBytes / 3) * 4)
  .regex(BASE64, 'padded base64')
  .refine((text) => base64Bytes(text) <= ARTIFACT_LIMITS.partBytes, {
    message: `at most ${ARTIFACT_LIMITS.partBytes} bytes`,
  });

/**
 * Runner to server: one part of a collected file. `index` numbers the turn's files from 0; every part of a file repeats
 * its `path`, `contentType` (what the runner made of it; the server tells again from the bytes), `size` and `sha256`;
 * `part` counts from 0 to `parts - 1`, each part but the last exactly `partBytes` long. A file an agent attaches with
 * `task_attach {path}` (S6a) carries the call's id (`callId`, index 0): its parts come right before that call's
 * `turn.tool`, and the server puts it together apart from the turn's collection. No answer.
 */
export const TurnArtifact = frame('turn.artifact', {
  turnId: Uuid,
  index: z
    .int()
    .min(0)
    .max(ARTIFACT_LIMITS.files - 1),
  path: ArtifactPath,
  contentType: z.string().min(1).max(100),
  size: z.int().min(0).max(ARTIFACT_LIMITS.fileBytes),
  sha256: Sha256Hex,
  part: z
    .int()
    .min(0)
    .max(ARTIFACT_PARTS_MAX - 1),
  parts: z.int().min(1).max(ARTIFACT_PARTS_MAX),
  data: ArtifactData,
  callId: Uuid.optional(),
});
export type TurnArtifact = z.infer<typeof TurnArtifact>;

/** A file the runner saw in the outputs folder but did not collect, and why. */
export const SkippedArtifact = protocolObject({
  path: ArtifactPath,
  size: z.int().min(0),
  reason: ArtifactSkipReason,
});
export type SkippedArtifact = z.infer<typeof SkippedArtifact>;

/**
 * Runner to server, after the last `turn.artifact` and before `turn.end`: how many files it sent (`files`) and the ones
 * it left out (`skipped`: too large, not text or an image, over the count or the total, unreadable; the first
 * `ARTIFACT_LIMITS.skipped`). No answer.
 */
export const TurnArtifacts = frame('turn.artifacts', {
  turnId: Uuid,
  files: z.int().min(0).max(ARTIFACT_LIMITS.files),
  skipped: z.array(SkippedArtifact).max(ARTIFACT_LIMITS.skipped),
});
export type TurnArtifacts = z.infer<typeof TurnArtifacts>;
