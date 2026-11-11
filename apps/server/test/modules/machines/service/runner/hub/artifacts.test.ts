import { createHash } from 'node:crypto';
import { ARTIFACT_LIMITS } from '@mwc/shared/flows';
import type { TurnArtifact } from '@mwc/shared/runner-protocol';
import { describe, expect, it } from 'vitest';
import { artifactAssembler } from '../../../../../../src/modules/machines/service/runner/hub/artifacts.ts';

const TURN = '019a7b2c-3d4e-7f5a-8b6c-7d8e9f0a1b2c';
const PART = ARTIFACT_LIMITS.partBytes;

/** A file's parts as the runner sends them. */
function parts(index: number, path: string, bytes: Uint8Array, sha256?: string): TurnArtifact[] {
  const count = Math.max(1, Math.ceil(bytes.length / PART));
  const hash = sha256 ?? createHash('sha256').update(bytes).digest('hex');
  return Array.from({ length: count }, (_, part) => ({
    type: 'turn.artifact',
    turnId: TURN,
    index,
    path,
    contentType: 'text/plain; charset=utf-8',
    size: bytes.length,
    sha256: hash,
    part,
    parts: count,
    data: Buffer.from(bytes.subarray(part * PART, (part + 1) * PART)).toString('base64'),
  }));
}

describe('artifactAssembler', () => {
  it('puts a file together from its parts in any order, typed from its bytes', () => {
    const files = artifactAssembler();
    const bytes = new Uint8Array(PART * 2 + 10).fill(0x62);
    const [a, b, c] = parts(0, 'log.txt', bytes);
    expect(files.part(c as TurnArtifact)).toBeUndefined();
    expect(files.part(a as TurnArtifact)).toBeUndefined();
    expect(files.waiting).toBe(1);
    const whole = files.part(b as TurnArtifact);
    expect(whole).toMatchObject({
      path: 'log.txt',
      contentType: 'text/plain; charset=utf-8',
      size: bytes.length,
    });
    expect(files.waiting).toBe(0);
  });

  it('takes an empty file in one empty part', () => {
    const [only] = parts(0, 'empty.md', new Uint8Array());
    expect(artifactAssembler().part(only as TurnArtifact)).toMatchObject({
      size: 0,
      contentType: 'text/markdown; charset=utf-8',
    });
  });

  it('drops a file whose parts disagree or repeat, and ignores its later parts', () => {
    const files = artifactAssembler();
    const [first, second] = parts(0, 'a.txt', new Uint8Array(PART + 1).fill(0x61));
    files.part(first as TurnArtifact);
    expect(files.part(first as TurnArtifact)).toEqual({ dropped: 'mismatch' });
    expect(files.part(second as TurnArtifact)).toBeUndefined();
    const [short] = parts(1, 'b.txt', new Uint8Array(3).fill(0x61));
    expect(files.part({ ...(short as TurnArtifact), parts: 2 })).toEqual({ dropped: 'mismatch' });
    const [other] = parts(2, 'c.txt', new Uint8Array(PART + 1).fill(0x61));
    files.part(other as TurnArtifact);
    expect(files.part({ ...(other as TurnArtifact), part: 1, path: 'renamed.txt', data: 'YQ==' })).toEqual({
      dropped: 'mismatch',
    });
  });

  it('drops what would take the turn past its total', () => {
    const files = artifactAssembler();
    const big = new Uint8Array(ARTIFACT_LIMITS.fileBytes).fill(0x61);
    for (let i = 0; i < 5; i++) {
      for (const part of parts(i, `f${i}.txt`, big)) files.part(part);
    }
    const [over] = parts(5, 'over.txt', new Uint8Array(1).fill(0x61));
    expect(files.part(over as TurnArtifact)).toEqual({ dropped: 'over_total' });
  });

  it('drops a file whose hash does not match, or that is binary', () => {
    const files = artifactAssembler();
    const [lie] = parts(0, 'lie.txt', new Uint8Array([0x61]), 'f'.repeat(64));
    expect(files.part(lie as TurnArtifact)).toEqual({ dropped: 'hash_mismatch' });
    const [bin] = parts(1, 'x.bin', new Uint8Array([0, 1, 2]));
    expect(files.part(bin as TurnArtifact)).toEqual({ dropped: 'binary' });
  });
});
