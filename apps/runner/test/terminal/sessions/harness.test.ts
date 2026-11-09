import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FakeHarnessDriver, fakeTerminalSpec } from '@mwc/harness-core/fake';
import type { TerminalSpec } from '@mwc/shared/harness';
import { newId } from '@mwc/shared/ids';
import type { TerminalRunnerFrame } from '@mwc/shared/runner-protocol';
import { describe, expect, it } from 'vitest';
import { TerminalSessions } from '../../../src/terminal/sessions.ts';
import type { HarnessHost } from '../../../src/turns/turns.ts';
import { memoryLog } from '../../fixtures/log.ts';
import { FakePtySpawner } from '../../fixtures/pty.ts';
import { FakeTime, settle } from '../../fixtures/time.ts';
import { FAKE_COMMAND, fakeHarnessHost } from '../../fixtures/turns.ts';

/** Terminals on a fake PTY with these harnesses; every frame they send is kept. */
function terminals(harness: HarnessHost | undefined) {
  const time = new FakeTime();
  const spawner = new FakePtySpawner();
  const sent: TerminalRunnerFrame[] = [];
  const logs = memoryLog();
  const sessions = new TerminalSessions({
    host: {
      spawn: spawner.spawn,
      env: { HOME: '/home/runner', MWC_RUNNER_CONFIG: '/etc/runner.json' },
      home: '/home/runner',
      platform: 'darwin',
      exists: () => false,
    },
    harness,
    timers: time,
    log: logs.log,
    send: (frame) => sent.push(frame) > 0,
    buffered: () => 0,
    count: () => {},
  });
  const open = (spec: TerminalSpec) => {
    const sessionId = newId();
    sessions.handle({ type: 'terminal.open', sessionId, cols: 100, rows: 30, harness: spec });
    return sessionId;
  };
  const exitOf = (sessionId: string) =>
    sent.find((frame) => frame.type === 'terminal.exit' && frame.sessionId === sessionId);
  return { sessions, time, spawner, sent, logs, open, exitOf };
}

/** A Codex harness whose login lives in the runner's private folder. */
function codex() {
  const driver = new FakeHarnessDriver({
    harness: 'codex',
    command: FAKE_COMMAND,
    privateDir: {
      env: 'CODEX_HOME',
      path: null,
      files: [{ name: 'auth.json', contents: '{"tokens":{}}', mode: 0o600 }],
    },
  });
  return fakeHarnessHost({ drivers: { codex: driver } });
}

describe("a chat's terminal", () => {
  it("starts the harness's TUI in the agent's folder, named in terminal.opened, its notices printed first", async () => {
    const notice = { type: 'notice', level: 'info', message: 'Resuming the chat' } as const;
    const { host, cwd } = fakeHarnessHost({ driver: { notices: [notice] } });
    const t = terminals(host);
    const sessionId = t.open(fakeTerminalSpec('claude_code', { cwd, sessionId: 's-9' }));
    const [spawned] = t.spawner.spawned;
    expect([spawned?.file, spawned?.args, spawned?.options.cwd]).toEqual([
      FAKE_COMMAND,
      ['terminal', '--resume', 's-9'],
      cwd,
    ]);
    expect(spawned?.options.env).toEqual({
      HOME: '/home/runner',
      TERM: 'xterm-256color',
      LANG: 'en_US.UTF-8',
    });
    expect(t.sent[0]).toEqual({ type: 'terminal.opened', sessionId, shell: FAKE_COMMAND });
    await t.time.advance(16);
    const output = t.sent.find((frame) => frame.type === 'terminal.output');
    expect(Buffer.from(output?.type === 'terminal.output' ? output.data : '', 'base64').toString()).toBe(
      '[info] Resuming the chat\r\n',
    );
    t.spawner.pty().exit(0);
    expect(t.exitOf(sessionId)).toEqual({ type: 'terminal.exit', sessionId, code: 0 });
  });

  it('sends back the Codex login its process rewrote, and releases the folder when it ends', async () => {
    const { host, cwd } = codex();
    const t = terminals(host);
    const sessionId = t.open(fakeTerminalSpec('codex', { cwd }));
    const home = t.spawner.spawned[0]?.options.env.CODEX_HOME as string;
    writeFileSync(join(home, 'auth.json'), '{"tokens":{"access_token":"fresh"}}');
    t.spawner.pty().exit(0);
    expect(t.exitOf(sessionId)).toEqual({
      type: 'terminal.exit',
      sessionId,
      code: 0,
      authJson: '{"tokens":{"access_token":"fresh"}}',
    });
    expect(existsSync(join(home, 'auth.json'))).toBe(false);
    expect(JSON.stringify(t.logs.entries)).not.toContain('fresh');
  });

  it('keeps a rewritten login that is not one to itself, saying so', () => {
    const { host, cwd } = codex();
    const t = terminals(host);
    const sessionId = t.open(fakeTerminalSpec('codex', { cwd }));
    writeFileSync(join(t.spawner.spawned[0]?.options.env.CODEX_HOME as string, 'auth.json'), 'oops');
    t.spawner.pty().exit(0);
    expect(t.exitOf(sessionId)).toEqual({ type: 'terminal.exit', sessionId, code: 0 });
    expect(t.logs.messages('warn')).toEqual([
      'the harness rewrote its login into something that is not one; not sent back',
    ]);
  });

  it('is unsupported without harnesses, and releases its folder when the TUI cannot start', async () => {
    const plain = terminals(undefined);
    const sessionId = plain.open(fakeTerminalSpec('claude_code'));
    expect(plain.sent).toEqual([{ type: 'terminal.exit', sessionId, code: null, error: 'unsupported' }]);
    const { host, cwd } = codex();
    const t = terminals(host);
    t.spawner.fails = new Error('posix_spawnp failed.');
    const failed = t.open(fakeTerminalSpec('codex', { cwd }));
    await settle();
    expect(t.exitOf(failed)).toEqual({
      type: 'terminal.exit',
      sessionId: failed,
      code: null,
      error: 'spawn_failed: posix_spawnp failed.',
    });
    expect(host.dirs.inUse).toEqual([]);
  });
});
