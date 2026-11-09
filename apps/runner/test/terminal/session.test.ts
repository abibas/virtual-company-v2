import { newId } from '@mwc/shared/ids';
import type { TerminalRunnerFrame } from '@mwc/shared/runner-protocol';
import { describe, expect, it } from 'vitest';
import { BUFFER_HIGH_BYTES, BUFFER_POLL_MS, OUTPUT_BATCH_BYTES } from '../../src/terminal/output.ts';
import { signalName, TerminalSession } from '../../src/terminal/session.ts';
import { memoryLog } from '../fixtures/log.ts';
import { FakePty } from '../fixtures/pty.ts';
import { FakeTime } from '../fixtures/time.ts';

describe('signal names', () => {
  it('names a signal by its number, and none for 0 or nothing', () => {
    expect(signalName(1)).toBe('SIGHUP');
    expect(signalName(9)).toBe('SIGKILL');
    expect(signalName(0)).toBeUndefined();
    expect(signalName(undefined)).toBeUndefined();
    expect(signalName(250)).toBe('SIG250');
  });
});

describe('a terminal session', () => {
  it('pauses its PTY while the link is backed up, and says when it ended once', async () => {
    const time = new FakeTime();
    const pty = new FakePty(42);
    const sent: TerminalRunnerFrame[] = [];
    const ended: string[] = [];
    let buffered = BUFFER_HIGH_BYTES + 1;
    const sessionId = newId();
    const session = new TerminalSession(sessionId, '/bin/bash', pty, {
      timers: time,
      log: memoryLog().log,
      send: (frame) => sent.push(frame) > 0,
      buffered: () => buffered,
      ended: (id) => ended.push(id),
    });
    pty.print(Buffer.alloc(OUTPUT_BATCH_BYTES));
    expect(pty.paused).toBe(true);
    buffered = 0;
    await time.advance(BUFFER_POLL_MS);
    expect(pty.paused).toBe(false);
    const done = session.close('idle_timeout');
    expect(session.close()).toBe(done);
    await done;
    expect(ended).toEqual([sessionId]);
    expect(sent.at(-1)).toEqual({
      type: 'terminal.exit',
      sessionId,
      code: null,
      signal: 'SIGHUP',
      error: 'idle_timeout',
    });
    expect(session.close()).toBe(done);
  });

  it('logs a kill that throws (the shell is gone)', () => {
    const pty = new FakePty(43);
    const logs = memoryLog();
    const session = new TerminalSession(newId(), '/bin/sh', pty, {
      timers: new FakeTime(),
      log: logs.log,
      send: () => true,
      buffered: () => 0,
      ended: () => {},
    });
    pty.failing = new Error('kill ESRCH');
    void session.close();
    expect(logs.entries.at(-1)).toMatchObject({
      msg: 'a terminal call failed',
      what: 'SIGHUP',
      error: 'kill ESRCH',
    });
  });
});
