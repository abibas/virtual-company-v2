import { describe, expect, it } from 'vitest';
import { ARTIFACT_LIMITS } from '../../src/flows.ts';
import { TurnSpec } from '../../src/harness.ts';
import { ArtifactData, TurnArtifact, TurnArtifacts } from '../../src/runner-protocol/artifacts.ts';
import { isTurnFrame } from '../../src/runner-protocol/turns.ts';
import { encodeFrame, parseRunnerFrame } from '../../src/runner-protocol.ts';
import { RUNNER_EXAMPLES, TURN_SPEC } from '../fixtures/runner-protocol/frames.ts';

const part = RUNNER_EXAMPLES['turn.artifact'];
const summary = RUNNER_EXAMPLES['turn.artifacts'];

describe('turn.artifact', () => {
  it('reads a part, a turn frame', () => {
    const parsed = TurnArtifact.parse(part);
    expect(parsed).toEqual(part);
    expect(isTurnFrame(parsed)).toBe(true);
  });

  it('refuses a bad index, part, path, hash or size', () => {
    for (const bad of [
      { index: ARTIFACT_LIMITS.files },
      { index: -1 },
      { part: 16 },
      { parts: 0 },
      { parts: 17 },
      { path: '../escape' },
      { path: '/abs' },
      { sha256: 'abc' },
      { size: ARTIFACT_LIMITS.fileBytes + 1 },
      { contentType: '' },
    ])
      expect(TurnArtifact.safeParse({ ...part, ...bad }).success, JSON.stringify(bad)).toBe(false);
  });

  it('takes padded base64 up to a part’s bytes, an empty part too', () => {
    expect(ArtifactData.safeParse('').success).toBe(true);
    expect(ArtifactData.safeParse('aGk=').success).toBe(true);
    expect(ArtifactData.safeParse('aGk').success).toBe(false);
    expect(ArtifactData.safeParse('a b=').success).toBe(false);
    const full = Buffer.alloc(ARTIFACT_LIMITS.partBytes, 7).toString('base64');
    expect(ArtifactData.safeParse(full).success).toBe(true);
    const over = Buffer.alloc(ARTIFACT_LIMITS.partBytes + 1, 7).toString('base64');
    expect(ArtifactData.safeParse(over).success).toBe(false);
  });

  it('fits a full part in one frame', () => {
    const data = Buffer.alloc(ARTIFACT_LIMITS.partBytes, 255).toString('base64');
    const text = encodeFrame({ ...part, path: 'x'.repeat(ARTIFACT_LIMITS.name), data });
    expect(parseRunnerFrame(text).kind).toBe('frame');
  });
});

describe('turn.artifacts', () => {
  it('reads the count and the skipped files', () => {
    expect(TurnArtifacts.parse(summary)).toEqual(summary);
    expect(TurnArtifacts.parse({ ...summary, files: 0, skipped: [] }).skipped).toEqual([]);
  });

  it('refuses too many files or skipped entries, and an unknown reason', () => {
    const skipped = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ path: `f${i}`, size: 1, reason: 'binary' }));
    expect(TurnArtifacts.safeParse({ ...summary, files: ARTIFACT_LIMITS.files + 1 }).success).toBe(false);
    expect(
      TurnArtifacts.safeParse({ ...summary, skipped: skipped(ARTIFACT_LIMITS.skipped + 1) }).success,
    ).toBe(false);
    expect(
      TurnArtifacts.safeParse({ ...summary, skipped: [{ path: 'a', size: 1, reason: 'secret' }] }).success,
    ).toBe(false);
  });
});

describe('TurnSpec.artifacts', () => {
  it('takes an outputs folder, and a spec without one', () => {
    const dir = 'tasks/T-12/artifacts/1-develop/round-1';
    expect(TurnSpec.parse({ ...TURN_SPEC, artifacts: { dir } }).artifacts).toEqual({ dir });
    expect(TurnSpec.parse(TURN_SPEC).artifacts).toBeUndefined();
  });

  it('refuses a folder that climbs out or is absolute', () => {
    for (const dir of ['../x', '/tmp/x', 'tasks/../../etc'])
      expect(TurnSpec.safeParse({ ...TURN_SPEC, artifacts: { dir } }).success, dir).toBe(false);
  });
});
