import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeTurnSpec } from '@mwc/harness-core/fake';
import { newId } from '@mwc/shared/ids';
import type { TurnArtifact, TurnArtifacts } from '@mwc/shared/runner-protocol';
import { describe, expect, it, vi } from 'vitest';
import type { ArtifactFs } from '../../../src/turns/artifacts/collect.ts';
import { nodeArtifactFs } from '../../../src/turns/artifacts/fs.ts';
import { answerLines, FAKE_COMMAND, fakeHarnessHost, turnsWorld } from '../../fixtures/turns.ts';

const DIR = 'tasks/T-12/artifacts/1-develop/round-1';

/** A world whose host collects a task step's outputs with `artifacts` (the real file system; null: none). */
function artifactsWorld(given?: ArtifactFs | null) {
  const artifacts = given === null ? undefined : (given ?? nodeArtifactFs());
  const fake = fakeHarnessHost();
  const w = turnsWorld({ host: { ...fake.host, ...(artifacts ? { artifacts } : {}) } });
  return { ...fake, w };
}

const start = (w: ReturnType<typeof turnsWorld>, cwd: string, dir?: string) => {
  const turnId = newId();
  const spec = { ...fakeTurnSpec('claude_code', { cwd }), ...(dir ? { artifacts: { dir } } : {}) };
  w.turns.handle({ type: 'turn.start', turnId, spec });
  return turnId;
};

describe("a task step's turn", () => {
  it('makes its outputs folder before the process, and sends what it wrote after its events, before its end', async () => {
    const { w, cwd } = artifactsWorld();
    let madeBefore = false;
    w.spawn.when(FAKE_COMMAND, (child) => {
      madeBefore = existsSync(join(cwd, DIR));
      writeFileSync(join(cwd, DIR, 'notes.md'), '# Notes');
      writeFileSync(join(cwd, DIR, 'build.zip'), Buffer.from([0x50, 0x4b, 0, 0xff]));
      child.finish(answerLines('Done.'), 0);
    });
    const turnId = start(w, cwd, DIR);
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    expect(madeBefore).toBe(true);
    expect(w.sent.map((frame) => frame.type)).toEqual([
      'turn.events',
      'turn.artifact',
      'turn.artifacts',
      'turn.end',
    ]);
    const part = w.sent[1] as TurnArtifact;
    expect(part).toMatchObject({ turnId, index: 0, path: 'notes.md', size: 7, part: 0, parts: 1 });
    expect(Buffer.from(part.data, 'base64').toString()).toBe('# Notes');
    expect(w.sent[2] as TurnArtifacts).toEqual({
      type: 'turn.artifacts',
      turnId,
      files: 1,
      skipped: [{ path: 'build.zip', size: 4, reason: 'binary' }],
    });
    expect(w.logs.entries.some((e) => e.msg === 'turn outputs collected')).toBe(true);
  });

  it('sends nothing more without an outputs folder, or on a runner without the file system for it', async () => {
    const plain = artifactsWorld();
    plain.w.spawn.when(FAKE_COMMAND, (child) => child.finish(answerLines(), 0));
    start(plain.w, plain.cwd);
    await vi.waitFor(() => expect(plain.w.ends()).toHaveLength(1));
    expect(plain.w.sent.map((frame) => frame.type)).toEqual(['turn.events', 'turn.end']);
    const without = artifactsWorld(null);
    without.w.spawn.when(FAKE_COMMAND, (child) => child.finish(answerLines(), 0));
    start(without.w, without.cwd, DIR);
    await vi.waitFor(() => expect(without.w.ends()).toHaveLength(1));
    expect(without.w.sent.map((frame) => frame.type)).toEqual(['turn.events', 'turn.end']);
    expect(existsSync(join(without.cwd, DIR))).toBe(false);
  });

  it('still ends the turn when the collection fails', async () => {
    const real = nodeArtifactFs();
    const broken: ArtifactFs = {
      ...real,
      walk: (dir, max, depth) => {
        if (existsSync(join(dir, 'boom'))) throw new Error('disk gone');
        return real.walk(dir, max, depth);
      },
    };
    const { w, cwd } = artifactsWorld(broken);
    w.spawn.when(FAKE_COMMAND, (child) => {
      writeFileSync(join(cwd, DIR, 'boom'), 'x');
      child.finish(answerLines(), 0);
    });
    start(w, cwd, DIR);
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    expect(w.sent.map((frame) => frame.type)).toEqual(['turn.events', 'turn.end']);
    expect(w.logs.entries.find((e) => e.msg === 'turn outputs could not be collected')).toMatchObject({
      error: 'disk gone',
    });
  });
});
