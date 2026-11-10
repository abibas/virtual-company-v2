import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ClaudeCodeDriver } from '@mwc/harness-claude-code';
import { CodexDriver } from '@mwc/harness-codex';
import { HarnessError } from '@mwc/harness-core';
import { FAKE_CREDENTIALS, FakeHarnessDriver, fakeTurnSpec } from '@mwc/harness-core/fake';
import type { TurnSpec } from '@mwc/shared/harness';
import { newId } from '@mwc/shared/ids';
import { TURN_STOP_KILL_MS, TURN_STOP_TERM_MS } from '@mwc/shared/runner-protocol';
import { describe, expect, it, vi } from 'vitest';
import { nodePrivateFs } from '../../src/turns/files.ts';
import { settle } from '../fixtures/time.ts';
import { answerLines, FAKE_COMMAND, fakeHarnessHost, turnsWorld } from '../fixtures/turns.ts';

const start = (w: ReturnType<typeof turnsWorld>, spec: TurnSpec, turnId = newId()) => {
  w.turns.handle({ type: 'turn.start', turnId, spec });
  return turnId;
};

/** A Codex host whose driver keeps its login in a private folder of the runner's. */
function codexHost(authJson = FAKE_CREDENTIALS.codex_oauth.authJson) {
  const driver = new FakeHarnessDriver({
    harness: 'codex',
    command: FAKE_COMMAND,
    privateDir: {
      env: 'CODEX_HOME',
      path: null,
      files: [{ name: 'auth.json', contents: authJson, mode: 0o600 }],
    },
  });
  return fakeHarnessHost({ drivers: { codex: driver } });
}

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
      stdio: ['pipe', 'pipe', 'pipe'],
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

  it('ends every live turn when the link drops, and refuses new ones once the runner stops', async () => {
    const { host, cwd } = fakeHarnessHost();
    const w = turnsWorld({ host });
    start(w, fakeTurnSpec('claude_code', { cwd }));
    start(w, fakeTurnSpec('claude_code', { cwd }));
    await settle();
    await w.turns.stopAll('link_lost');
    expect(w.ends().map((end) => end.error)).toEqual(['link_lost', 'link_lost']);
    start(w, fakeTurnSpec('claude_code', { cwd }));
    await settle();
    await w.turns.stop();
    expect(w.ends().map((end) => end.error)).toEqual(['link_lost', 'link_lost', 'runner_stopping']);
    start(w, fakeTurnSpec('claude_code', { cwd }));
    expect(w.ends().at(-1)?.error).toBe('runner_stopping');
  });
});

describe("a Codex turn's private folder", () => {
  it('holds the login 0600 only while the process runs, and sends back the login it rewrote', async () => {
    const { host, cwd, stateDir } = codexHost();
    const w = turnsWorld({ host });
    let during: { mode: number; folderMode: number } | undefined;
    w.spawn.when(FAKE_COMMAND, (child) => {
      const home = w.spawn.calls[0]?.options.env?.CODEX_HOME as string;
      during = {
        mode: statSync(join(home, 'auth.json')).mode & 0o777,
        folderMode: statSync(home).mode & 0o777,
      };
      writeFileSync(join(home, 'auth.json'), '{"tokens":{"access_token":"fresh"}}');
      child.finish(answerLines(), 0);
    });
    const turnId = start(w, fakeTurnSpec('codex', { cwd }));
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    const home = w.spawn.calls[0]?.options.env?.CODEX_HOME as string;
    expect(home.startsWith(join(stateDir, 'codex'))).toBe(true);
    expect(during).toEqual({ mode: 0o600, folderMode: 0o700 });
    expect(existsSync(join(home, 'auth.json'))).toBe(false);
    expect(existsSync(home)).toBe(true);
    expect(w.ends()[0]).toEqual({
      type: 'turn.end',
      turnId,
      ok: true,
      exitCode: 0,
      authJson: '{"tokens":{"access_token":"fresh"}}',
    });
    expect(JSON.stringify(w.logs.entries)).not.toContain('fresh');
  });

  it('sends nothing back when the login is the same, or rewritten into something that is not a login', async () => {
    const same = codexHost();
    const w = turnsWorld({ host: same.host });
    w.spawn.when(FAKE_COMMAND, (child) => child.finish(answerLines(), 0));
    start(w, fakeTurnSpec('codex', { cwd: same.cwd }));
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    expect(w.ends()[0]).not.toHaveProperty('authJson');
    const broken = codexHost();
    const b = turnsWorld({ host: broken.host });
    b.spawn.when(FAKE_COMMAND, (child) => {
      writeFileSync(join(b.spawn.calls[0]?.options.env?.CODEX_HOME as string, 'auth.json'), 'not json');
      child.finish(answerLines(), 0);
    });
    start(b, fakeTurnSpec('codex', { cwd: broken.cwd }));
    await vi.waitFor(() => expect(b.ends()).toHaveLength(1));
    expect(b.ends()[0]).not.toHaveProperty('authJson');
    expect(b.logs.messages('warn')).toEqual([
      'the harness rewrote its login into something that is not one; not sent back',
    ]);
  });
});

describe("a Claude Code turn's settings file", () => {
  /** A host on the real Claude Code driver, started as the fake program. */
  const claudeHost = () =>
    fakeHarnessHost({ drivers: { claude_code: new ClaudeCodeDriver({ command: FAKE_COMMAND }) } });

  it('holds the profile’s gateway 0600 while the process runs, named by --settings, and goes after it', async () => {
    const { host, cwd, stateDir } = claudeHost();
    const w = turnsWorld({ host });
    let during: { settings: unknown; mode: number } | undefined;
    w.spawn.when(FAKE_COMMAND, (child) => {
      const args = w.spawn.calls[0]?.args as string[];
      const path = args[args.indexOf('--settings') + 1] as string;
      during = { settings: JSON.parse(readFileSync(path, 'utf8')), mode: statSync(path).mode & 0o777 };
      child.finish('', 0);
    });
    const gateway = { baseUrl: 'http://127.0.0.1:8300', headers: { 'x-airia-key': 'gw-secret' } };
    start(w, fakeTurnSpec('claude_code', { cwd, gateway }));
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    const [call] = w.spawn.calls;
    const path = call?.args.at(-1) as string;
    expect(call?.args.at(-2)).toBe('--settings');
    expect(path.startsWith(join(stateDir, 'claude_code'))).toBe(true);
    expect(path).toMatch(/settings-[0-9a-f]{12}\.json$/);
    expect(during).toEqual({
      settings: {
        env: {
          ANTHROPIC_BASE_URL: 'http://127.0.0.1:8300',
          ANTHROPIC_CUSTOM_HEADERS: 'x-airia-key: gw-secret',
        },
      },
      mode: 0o600,
    });
    expect(existsSync(path)).toBe(false);
    expect(call?.args.join(' ')).not.toContain('gw-secret');
    expect(call?.options.env).toMatchObject({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:8300' });
    expect(call?.options.env).not.toHaveProperty('CLAUDE_CONFIG_DIR');
    expect(JSON.stringify(w.logs.entries)).not.toContain('gw-secret');
  });

  it('without a gateway, points the turn at Anthropic itself so the machine’s own gateway is not used', async () => {
    const { host, cwd } = claudeHost();
    const w = turnsWorld({ host });
    let settings: unknown;
    w.spawn.when(FAKE_COMMAND, (child) => {
      settings = JSON.parse(readFileSync(w.spawn.calls[0]?.args.at(-1) as string, 'utf8'));
      child.finish('', 0);
    });
    start(w, fakeTurnSpec('claude_code', { cwd }));
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    expect(settings).toEqual({
      env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com', ANTHROPIC_CUSTOM_HEADERS: '' },
    });
    expect(w.spawn.calls[0]?.options.env).not.toHaveProperty('ANTHROPIC_BASE_URL');
    expect(host.dirs.inUse).toEqual([]);
  });
});

describe("a Codex turn's context reading", () => {
  const THREAD = '01a1c212-3068-7e90-8f9c-95e922ca6d88';
  const line = (type: string, payload: object) =>
    JSON.stringify({ timestamp: 't', ordinal: 0, type, payload });
  /** Codex's session file of the thread: its turn's model, then a request's reading. */
  const ROLLOUT = [
    line('turn_context', { model: 'gpt-6.1-sol', effort: 'xhigh' }),
    line('event_msg', {
      type: 'token_count',
      info: {
        last_token_usage: {
          input_tokens: 35_409,
          cached_input_tokens: 33_152,
          output_tokens: 456,
          total_tokens: 35_865,
        },
        model_context_window: 475_000,
      },
      rate_limits: null,
    }),
  ].join('\n');
  const STDOUT = [
    JSON.stringify({ type: 'thread.started', thread_id: THREAD }),
    JSON.stringify({
      type: 'turn.completed',
      usage: { input_tokens: 249_000, cached_input_tokens: 225_000, output_tokens: 1500 },
    }),
  ].join('\n');

  it("ends with Codex's own reading from the thread's file in the turn's home folder", async () => {
    const driver = new CodexDriver({ command: FAKE_COMMAND, rollouts: nodePrivateFs() });
    const { host, cwd } = fakeHarnessHost({ drivers: { codex: driver } });
    const w = turnsWorld({ host });
    w.spawn.when(FAKE_COMMAND, (child) => {
      const day = join(w.spawn.calls[0]?.options.env?.CODEX_HOME as string, 'sessions', '2026', '11', '09');
      mkdirSync(day, { recursive: true });
      writeFileSync(join(day, `rollout-2026-11-09T22-48-54-${THREAD}.jsonl`), ROLLOUT);
      child.finish(`${STDOUT}\n`, 0);
    });
    start(w, fakeTurnSpec('codex', { cwd }));
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    const context = w.events().find((item) => item.event.type === 'context')?.event;
    expect(context).toMatchObject({ usedTokens: 35_865, window: 475_000, model: 'gpt-6.1-sol' });
    expect(context).not.toHaveProperty('estimate');
    expect(w.ends()[0]).toMatchObject({ ok: true });
  });
});
