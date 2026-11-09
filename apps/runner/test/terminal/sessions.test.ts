import { newId } from '@mwc/shared/ids';
import { TERMINAL_IDLE_MS, type TerminalRunnerFrame } from '@mwc/shared/runner-protocol';
import { describe, expect, it } from 'vitest';
import { IDLE_NOTICE, KILL_AFTER_MS } from '../../src/terminal/session.ts';
import { type TerminalHost, TerminalSessions } from '../../src/terminal/sessions.ts';
import { memoryLog } from '../fixtures/log.ts';
import { FakePtySpawner } from '../fixtures/pty.ts';
import { FakeTime, settle } from '../fixtures/time.ts';

const ENV = {
  HOME: '/home/ihor',
  SHELL: '/bin/zsh',
  PATH: '/usr/bin:/bin',
  MWC_RUNNER_CONFIG: '/home/ihor/.config/mwc/runner.json',
  MWC_ENROLL_TOKEN: 'mwc_et_secret',
};

/** The terminals of a runner on fake time, with a fake PTY; every frame they send is kept. */
function terminals(options: { host?: TerminalHost | null; buffered?: () => number } = {}) {
  const time = new FakeTime();
  const spawner = new FakePtySpawner();
  const sent: TerminalRunnerFrame[] = [];
  const counts: number[] = [];
  const logs = memoryLog();
  const host: TerminalHost = {
    spawn: spawner.spawn,
    env: ENV,
    home: '/home/ihor',
    platform: 'linux',
    exists: (path) => ['/bin/zsh', '/bin/bash', '/bin/sh'].includes(path),
  };
  const sessions = new TerminalSessions({
    host: options.host === null ? undefined : (options.host ?? host),
    timers: time,
    log: logs.log,
    send: (frame) => {
      sent.push(frame);
      return true;
    },
    buffered: options.buffered ?? (() => 0),
    count: (open) => counts.push(open),
  });
  const open = (sessionId = newId(), cols = 120, rows = 40) => {
    sessions.handle({ type: 'terminal.open', sessionId, cols, rows });
    return sessionId;
  };
  const of = <T extends TerminalRunnerFrame['type']>(type: T) =>
    sent.filter((frame): frame is Extract<TerminalRunnerFrame, { type: T }> => frame.type === type);
  return { sessions, time, spawner, sent, counts, logs, open, of };
}

const decoded = (frames: readonly { data: string }[]) =>
  frames.map((frame) => Buffer.from(frame.data, 'base64').toString()).join('');

describe('opening a terminal', () => {
  it("starts the user's login shell in the home folder, sized, with the runner's environment less MWC_*", () => {
    const { sessions, spawner, open, sent, counts } = terminals();
    expect(sessions.available).toBe(true);
    const sessionId = open();
    expect(spawner.spawned).toHaveLength(1);
    const [spawned] = spawner.spawned;
    expect(spawned?.file).toBe('/bin/zsh');
    expect(spawned?.args).toEqual(['-l']);
    expect(spawned?.options).toEqual({
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: '/home/ihor',
      env: {
        HOME: '/home/ihor',
        SHELL: '/bin/zsh',
        PATH: '/usr/bin:/bin',
        TERM: 'xterm-256color',
        LANG: 'C.UTF-8',
      },
      encoding: null,
    });
    expect(sent).toEqual([{ type: 'terminal.opened', sessionId, shell: '/bin/zsh' }]);
    expect(sessions.open).toBe(1);
    expect(counts).toEqual([1]);
  });

  it('opens at most 4 at once, and refuses the fifth with too_many_sessions', () => {
    const { sessions, open, of, spawner } = terminals();
    for (let i = 0; i < 4; i++) open();
    const fifth = open();
    expect(spawner.spawned).toHaveLength(4);
    expect(sessions.open).toBe(4);
    expect(of('terminal.exit')).toEqual([
      { type: 'terminal.exit', sessionId: fifth, code: null, error: 'too_many_sessions' },
    ]);
  });

  it('refuses every open without a PTY, and ignores a second open of an open terminal', () => {
    const none = terminals({ host: null });
    expect(none.sessions.available).toBe(false);
    const sessionId = none.open();
    expect(none.sent).toEqual([
      { type: 'terminal.exit', sessionId, code: null, error: 'terminal_unavailable' },
    ]);
    const { open, spawner, sent, logs } = terminals();
    const again = open();
    open(again);
    expect(spawner.spawned).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(logs.messages('warn')).toEqual(['a second terminal.open for an open terminal; ignored']);
  });

  it('says spawn_failed and why when the shell cannot start, and counts nothing', () => {
    const { spawner, open, sent, counts, sessions } = terminals();
    spawner.fails = new Error('posix_spawnp failed.');
    const sessionId = open();
    expect(sent).toEqual([
      { type: 'terminal.exit', sessionId, code: null, error: 'spawn_failed: posix_spawnp failed.' },
    ]);
    expect(counts).toEqual([]);
    expect(sessions.open).toBe(0);
    spawner.fails = 'EAGAIN' as unknown as Error;
    const again = open();
    expect(sent.at(-1)).toEqual({
      type: 'terminal.exit',
      sessionId: again,
      code: null,
      error: 'spawn_failed: EAGAIN',
    });
  });
});

describe('an open terminal', () => {
  it('writes the input as raw bytes, resizes, and ignores frames for terminals it does not have', () => {
    const { sessions, spawner, open, logs } = terminals();
    const sessionId = open();
    const bytes = Buffer.from('ls -la ü\r');
    sessions.handle({ type: 'terminal.input', sessionId, data: bytes.toString('base64') });
    sessions.handle({ type: 'terminal.resize', sessionId, cols: 80, rows: 24 });
    expect(spawner.pty().written).toEqual([bytes]);
    expect(spawner.pty().sizes).toEqual([[80, 24]]);
    const other = newId();
    sessions.handle({ type: 'terminal.input', sessionId: other, data: 'aGk=' });
    sessions.handle({ type: 'terminal.close', sessionId: other });
    expect(logs.messages()).toContain('a terminal frame for no open terminal; ignored');
  });

  it('sends its output batched, then its exit code when the shell exits by itself', async () => {
    const { spawner, open, of, time, counts, sessions } = terminals();
    const sessionId = open();
    const pty = spawner.pty();
    pty.print('hello ');
    pty.print(Buffer.from('world\r\n'));
    expect(of('terminal.output')).toEqual([]);
    await time.advance(16);
    expect(decoded(of('terminal.output'))).toBe('hello world\r\n');
    pty.print('bye\r\n');
    pty.exit(0);
    expect(decoded(of('terminal.output'))).toBe('hello world\r\nbye\r\n');
    expect(of('terminal.exit')).toEqual([{ type: 'terminal.exit', sessionId, code: 0 }]);
    expect(counts).toEqual([1, 0]);
    expect(sessions.open).toBe(0);
    // A second report of the end changes nothing.
    pty.exit(1);
    expect(of('terminal.exit')).toHaveLength(1);
  });

  it('closes on terminal.close with SIGHUP and says the signal; ignores input once closing', async () => {
    const { sessions, spawner, open, of } = terminals();
    const sessionId = open();
    sessions.handle({ type: 'terminal.close', sessionId });
    sessions.handle({ type: 'terminal.input', sessionId, data: 'aGk=' });
    await settle();
    expect(spawner.pty().signals).toEqual(['SIGHUP']);
    expect(spawner.pty().written).toEqual([]);
    expect(of('terminal.exit')).toEqual([{ type: 'terminal.exit', sessionId, code: null, signal: 'SIGHUP' }]);
  });

  it('kills a shell that ignores SIGHUP 5 s later', async () => {
    const { sessions, spawner, open, of, time } = terminals();
    const sessionId = open();
    spawner.pty().dies = false;
    sessions.handle({ type: 'terminal.close', sessionId });
    await time.advance(KILL_AFTER_MS - 1);
    expect(spawner.pty().signals).toEqual(['SIGHUP']);
    spawner.pty().dies = true;
    await time.advance(1);
    expect(spawner.pty().signals).toEqual(['SIGHUP', 'SIGKILL']);
    expect(of('terminal.exit')).toEqual([
      { type: 'terminal.exit', sessionId, code: null, signal: 'SIGKILL' },
    ]);
  });

  it('closes 60 minutes after the last input, with a notice line first', async () => {
    const { sessions, spawner, open, of, time } = terminals();
    const sessionId = open();
    await time.advance(TERMINAL_IDLE_MS - 1000);
    sessions.handle({ type: 'terminal.input', sessionId, data: 'aGk=' });
    await time.advance(TERMINAL_IDLE_MS - 1);
    expect(spawner.pty().signals).toEqual([]);
    await time.advance(1);
    expect(decoded(of('terminal.output'))).toBe(IDLE_NOTICE);
    expect(of('terminal.exit')).toEqual([
      { type: 'terminal.exit', sessionId, code: null, signal: 'SIGHUP', error: 'idle_timeout' },
    ]);
  });

  it('logs a PTY that throws once its shell is gone, and does not resize after the end', async () => {
    const { sessions, spawner, open, logs } = terminals();
    const sessionId = open();
    const pty = spawner.pty();
    pty.failing = new Error('ioctl(2) failed, EBADF');
    sessions.handle({ type: 'terminal.resize', sessionId, cols: 90, rows: 30 });
    expect(logs.entries.at(-1)).toMatchObject({ msg: 'a terminal call failed', what: 'resize' });
    pty.failing = undefined;
    pty.exit(0, 0);
    sessions.handle({ type: 'terminal.resize', sessionId, cols: 90, rows: 30 });
    expect(pty.sizes).toEqual([]);
  });
});

describe('closing every terminal', () => {
  it('ends them all with the reason, and refuses new ones once the runner stops', async () => {
    const { sessions, open, of, counts } = terminals();
    const [a, b] = [open(), open()];
    await sessions.closeAll('link_lost');
    expect(of('terminal.exit')).toEqual([
      { type: 'terminal.exit', sessionId: a, code: null, signal: 'SIGHUP', error: 'link_lost' },
      { type: 'terminal.exit', sessionId: b, code: null, signal: 'SIGHUP', error: 'link_lost' },
    ]);
    expect(counts).toEqual([1, 2, 1, 0]);
    const c = open();
    await sessions.stop();
    expect(of('terminal.exit').at(-1)).toMatchObject({ sessionId: c, error: 'runner_stopping' });
    const late = open();
    expect(of('terminal.exit').at(-1)).toEqual({
      type: 'terminal.exit',
      sessionId: late,
      code: null,
      error: 'runner_stopping',
    });
  });
});
