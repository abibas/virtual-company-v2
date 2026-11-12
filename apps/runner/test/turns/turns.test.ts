import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HarnessError } from '@mwc/harness-core';
import { FakeHarnessDriver, fakeTurnSpec } from '@mwc/harness-core/fake';
import { newId } from '@mwc/shared/ids';
import { TURN_STOP_KILL_MS, TURN_STOP_TERM_MS } from '@mwc/shared/runner-protocol';
import { describe, expect, it, vi } from 'vitest';
import { settle } from '../fixtures/time.ts';
import {
  answerLines,
  codexHost,
  FAKE_COMMAND,
  fakeHarnessHost,
  startTurn as start,
  turnsWorld,
} from '../fixtures/turns.ts';

describe('a chat turn', () => {
  it('runs the driver’s process in the agent’s folder, the prompt on stdin, and sends its events and end', async () => {
    const env = {
      PATH: '/usr/bin',
      MWC_RUNNER_CONFIG: '/etc/runner.json',
      ANTHROPIC_API_KEY: 'stray',
      KEEP: '1',
    };
    const { host, cwd } = fakeHarnessHost({
      env,
      driver: { env: { CLAUDE_CODE_OAUTH_TOKEN: 'token' }, unsetEnv: ['ANTHROPIC_API_KEY'] },
    });
    const w = turnsWorld({ host });
    w.spawn.when(FAKE_COMMAND, (child) => child.finish(answerLines('4'), 0));
    const turnId = start(w, fakeTurnSpec('claude_code', { cwd, prompt: 'What is 2 + 2?' }));
    expect(w.counts).toEqual([1]);
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    const [call] = w.spawn.calls;
    expect(call?.args).toEqual(['turn']);
    expect(call?.options).toEqual({
      stdio: ['pipe', 'ignore', 'ignore'],
      detached: true,
      cwd,
      env: { PATH: '/usr/bin', KEEP: '1', CLAUDE_CODE_OAUTH_TOKEN: 'token' },
    });
    expect(call?.child.input).toBe('What is 2 + 2?');
    expect(call?.child.inputClosed).toBe(true);
    expect(w.events().map((item) => [item.seq, item.event.type])).toEqual([
      [1, 'session'],
      [2, 'text'],
      [3, 'result'],
    ]);
    expect(w.ends()).toEqual([{ type: 'turn.end', turnId, ok: true, exitCode: 0 }]);
    expect(w.counts).toEqual([1, 0]);
    expect(JSON.stringify(w.logs.entries)).not.toContain('token');
  });

  it('sends the driver’s notices first', async () => {
    const notice = { type: 'notice', level: 'warn', message: 'The gateway is not used' } as const;
    const { host, cwd } = fakeHarnessHost({ driver: { notices: [notice] } });
    const w = turnsWorld({ host });
    w.spawn.when(FAKE_COMMAND, (child) => child.finish(answerLines(), 0));
    start(w, fakeTurnSpec('claude_code', { cwd }));
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    expect(w.events()[0]).toEqual({ seq: 1, event: notice });
  });

  it('is unsupported without the harness, without a way to start processes, and without harnesses at all', () => {
    const { host, cwd } = fakeHarnessHost();
    const cases = [
      [turnsWorld({ host }), 'codex'],
      [turnsWorld({ host, processes: false }), 'claude_code'],
      [turnsWorld(), 'claude_code'],
    ] as const;
    for (const [w, harness] of cases) {
      const turnId = start(w, fakeTurnSpec(harness, { cwd }));
      expect(w.ends()).toEqual([
        { type: 'turn.end', turnId, ok: false, exitCode: null, error: 'unsupported' },
      ]);
      expect(w.spawn.calls).toEqual([]);
    }
  });

  it('is busy beyond its slots, and refuses an agent folder that is not there', () => {
    const { host, cwd } = fakeHarnessHost();
    const w = turnsWorld({ host, slots: 1 });
    start(w, fakeTurnSpec('claude_code', { cwd }));
    start(w, fakeTurnSpec('claude_code', { cwd }));
    expect(w.ends().map((end) => end.error)).toEqual(['busy']);
    const none = turnsWorld({ host, slots: 0 });
    start(none, fakeTurnSpec('claude_code', { cwd }));
    start(turnsWorld({ host }), fakeTurnSpec('claude_code', { cwd }));
    const missing = turnsWorld({ host });
    start(missing, fakeTurnSpec('claude_code', { cwd: join(cwd, 'gone') }));
    expect([none.ends()[0]?.error, missing.ends()[0]?.error]).toEqual(['busy', 'home_missing']);
  });

  it('refuses a spec the driver refuses, and a process that cannot start, releasing its folder', async () => {
    const { host, driver, cwd } = fakeHarnessHost();
    const w = turnsWorld({ host });
    driver.failNext(new HarnessError('invalid_spec', 'The model is not one word.'));
    start(w, fakeTurnSpec('claude_code', { cwd }));
    w.spawn.throwsFor.add(FAKE_COMMAND);
    start(w, fakeTurnSpec('claude_code', { cwd }));
    expect(w.ends().map((end) => end.error)).toEqual([
      'invalid_spec: The model is not one word.',
      `spawn_failed: cannot start ${FAKE_COMMAND}`,
    ]);
    const codex = codexHost();
    const cw = turnsWorld({ host: codex.host });
    cw.spawn.throwsFor.add(FAKE_COMMAND);
    start(cw, fakeTurnSpec('codex', { cwd: codex.cwd }));
    expect(cw.ends()[0]?.error).toBe(`spawn_failed: cannot start ${FAKE_COMMAND}`);
    expect(codex.host.dirs.inUse).toEqual([]);
    expect(w.counts).toEqual([]);
  });

  it('says spawn_failed when its private folder cannot be made, or the program is not there', async () => {
    const blocked = codexHost();
    writeFileSync(join(blocked.root, 'file'), 'x');
    const driver = new FakeHarnessDriver({
      harness: 'codex',
      command: FAKE_COMMAND,
      privateDir: { env: 'CODEX_HOME', path: join(blocked.root, 'file', 'home'), files: [] },
    });
    const w = turnsWorld({ host: { ...blocked.host, drivers: { codex: driver } } });
    start(w, fakeTurnSpec('codex', { cwd: blocked.cwd }));
    expect(w.ends()[0]?.error).toMatch(/^spawn_failed: /);
    const { host, cwd } = fakeHarnessHost();
    const missing = turnsWorld({ host });
    missing.spawn.when(FAKE_COMMAND, (child) => child.fail('spawn fake-harness ENOENT'));
    const turnId = start(missing, fakeTurnSpec('claude_code', { cwd }));
    await vi.waitFor(() => expect(missing.ends()).toHaveLength(1));
    expect(missing.ends()[0]).toEqual({
      type: 'turn.end',
      turnId,
      ok: false,
      exitCode: null,
      error: 'spawn_failed: spawn fake-harness ENOENT',
    });
    expect(missing.events().at(-1)?.event).toMatchObject({ type: 'result', ok: false });
  });

  it('ignores a second start of a live turn and a stop of none', async () => {
    const { host, cwd } = fakeHarnessHost();
    const w = turnsWorld({ host });
    const turnId = start(w, fakeTurnSpec('claude_code', { cwd }));
    start(w, fakeTurnSpec('claude_code', { cwd }), turnId);
    w.turns.handle({ type: 'turn.stop', turnId: newId() });
    expect(w.spawn.calls).toHaveLength(1);
    expect(w.ends()).toEqual([]);
    expect(w.logs.messages()).toEqual(
      expect.arrayContaining([
        'a second turn.start for a live turn; ignored',
        'turn.stop for no live turn; ignored',
      ]),
    );
    expect(w.turns.live).toBe(1);
  });

  it('stops by the ladder: SIGINT to its group, SIGTERM 5 s later, SIGKILL 10 s after the SIGINT', async () => {
    const { host, cwd } = fakeHarnessHost();
    const w = turnsWorld({ host });
    w.spawn.when(FAKE_COMMAND, (child) => {
      child.dies = false;
    });
    const turnId = start(w, fakeTurnSpec('claude_code', { cwd }));
    await settle();
    w.turns.handle({ type: 'turn.stop', turnId });
    w.turns.handle({ type: 'turn.stop', turnId });
    const pid = w.spawn.calls[0]?.child.pid;
    expect(w.spawn.groupKills).toEqual([{ pid, signal: 'SIGINT' }]);
    await w.time.advance(TURN_STOP_TERM_MS);
    expect(w.spawn.groupKills.map((kill) => kill.signal)).toEqual(['SIGINT', 'SIGTERM']);
    await w.time.advance(TURN_STOP_KILL_MS - TURN_STOP_TERM_MS);
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    expect(w.spawn.groupKills.map((kill) => kill.signal)).toEqual(['SIGINT', 'SIGTERM', 'SIGKILL']);
    expect(w.ends()[0]).toEqual({ type: 'turn.end', turnId, ok: false, exitCode: null, error: 'stopped' });
    expect(w.time.pending).toEqual([]);
  });

  it('keeps its turns running when the link drops and when the runner stops, and refuses new ones once it stops', async () => {
    const { host, cwd } = fakeHarnessHost({ driver: { liveInput: true } });
    const w = turnsWorld({ host });
    start(w, fakeTurnSpec('claude_code', { cwd }));
    start(w, fakeTurnSpec('claude_code', { cwd }));
    await settle();
    w.turns.linkDown();
    await w.turns.stop();
    expect(w.ends()).toEqual([]);
    expect(w.spawn.groupKills).toEqual([]);
    expect(w.spawn.calls.map((call) => [call.child.released, call.child.inputClosed])).toEqual([
      [true, false],
      [true, false],
    ]);
    start(w, fakeTurnSpec('claude_code', { cwd }));
    expect(w.ends().at(-1)?.error).toBe('runner_stopping');
  });
});
