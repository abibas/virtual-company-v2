import { mkdirSync, statSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fakeTurnSpec } from '@mwc/harness-core/fake';
import { newId } from '@mwc/shared/ids';
import { describe, expect, it, vi } from 'vitest';
import { nodeFoldersFs } from '../../src/folders/files.ts';
import { homeMaker } from '../../src/folders/mkdirp.ts';
import { harnessHost } from '../../src/turns/drivers.ts';
import { nodePrivateFs } from '../../src/turns/files.ts';
import { memoryLog } from '../fixtures/log.ts';
import { tempDir } from '../fixtures/runner.ts';
import { answerLines, FAKE_COMMAND, fakeHarnessHost, turnsWorld } from '../fixtures/turns.ts';

/** A container runner's harness host: its work volume a temporary folder, a missing home made there before a turn. */
function containerHost(options: { readonly gate?: Promise<void> } = {}) {
  const { host, root } = fakeHarnessHost();
  const work = join(root, 'work');
  mkdirSync(work);
  const logs = memoryLog();
  const make = homeMaker({ fs: nodeFoldersFs(), home: join(root, 'home'), root: work }, logs.log);
  const made: string[] = [];
  host.makeHome = async (path) => {
    made.push(path);
    await options.gate;
    return make(path);
  };
  return { host, root, work, logs, made };
}

const startIn = (w: ReturnType<typeof turnsWorld>, cwd: string) => {
  const turnId = newId();
  w.turns.handle({ type: 'turn.start', turnId, spec: fakeTurnSpec('claude_code', { cwd }) });
  return turnId;
};

describe("a container runner's turn whose home folder is not there yet", () => {
  it('makes the folder under the work volume (0755), then runs the turn in it', async () => {
    const { host, work, made, logs } = containerHost();
    const w = turnsWorld({ host });
    w.spawn.when(FAKE_COMMAND, (child) => child.finish(answerLines('4'), 0));
    const cwd = join(work, 'test-dev');
    const turnId = startIn(w, cwd);
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    expect(w.ends()[0]).toMatchObject({ turnId, ok: true });
    expect(w.spawn.calls[0]?.options.cwd).toBe(cwd);
    expect(statSync(cwd).isDirectory()).toBe(true);
    expect(statSync(cwd).mode & 0o777 & ~0o755).toBe(0);
    expect(statSync(cwd).mode & 0o700).toBe(0o700);
    expect(made).toEqual([cwd]);
    expect(logs.messages('info')).toContain("made the agent's home folder");
  });

  it('makes nothing for a folder that is there', async () => {
    const { host, work, made } = containerHost();
    mkdirSync(join(work, 'scout'));
    const w = turnsWorld({ host });
    w.spawn.when(FAKE_COMMAND, (child) => child.finish(answerLines(), 0));
    startIn(w, join(work, 'scout'));
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    expect(made).toEqual([]);
  });

  it('still says home_missing outside the work volume, and through a link out of it', async () => {
    const { host, root, work } = containerHost();
    mkdirSync(join(root, 'elsewhere'));
    symlinkSync(join(root, 'elsewhere'), join(work, 'escape'));
    const w = turnsWorld({ host, slots: 2 });
    startIn(w, join(root, 'outside'));
    startIn(w, join(work, 'escape', 'agent'));
    await vi.waitFor(() => expect(w.ends()).toHaveLength(2));
    expect(w.ends().map((end) => end.error)).toEqual(['home_missing', 'home_missing']);
    expect(() => statSync(join(root, 'elsewhere', 'agent'))).toThrow();
    expect(w.spawn.calls).toEqual([]);
  });

  it('does not start a turn stopped while its folder is being made', async () => {
    const { promise: gate, resolve } = Promise.withResolvers<void>();
    const { host, work } = containerHost({ gate });
    const w = turnsWorld({ host });
    const turnId = startIn(w, join(work, 'new'));
    w.turns.handle({ type: 'turn.stop', turnId });
    resolve();
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    expect(w.ends()[0]).toMatchObject({ turnId, error: 'stopped' });
    expect(w.spawn.calls).toEqual([]);
  });

  it('is not made without the harness, or by a runner that is not in a container', async () => {
    const { host, work, made } = containerHost();
    const w = turnsWorld({ host });
    w.turns.handle({
      type: 'turn.start',
      turnId: newId(),
      spec: fakeTurnSpec('codex', { cwd: join(work, 'x') }),
    });
    expect(w.ends()[0]).toMatchObject({ error: 'unsupported' });
    expect(made).toEqual([]);
    const plain = harnessHost(
      { clis: {}, env: {}, fs: nodePrivateFs(), stateDir: join(tempDir(), 's') },
      memoryLog().log,
    );
    expect(plain.makeHome).toBeUndefined();
    const maker = async () => true;
    const withMaker = harnessHost(
      { clis: {}, env: {}, fs: nodePrivateFs(), stateDir: join(tempDir(), 's'), makeHome: maker },
      memoryLog().log,
    );
    expect(withMaker.makeHome).toBe(maker);
  });
});
