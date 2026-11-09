import { newId } from '@mwc/shared/ids';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIVE_RUNS_HOLD_MS } from '../../src/hold/manager.ts';
import type { TerminalHost } from '../../src/terminal/sessions.ts';
import { cleanUpLinks, fakeServer } from '../fixtures/link.ts';
import { FakePtySpawner } from '../fixtures/pty.ts';
import { startRunner, stopRunners } from '../fixtures/runner.ts';

afterEach(async () => {
  await stopRunners();
  await cleanUpLinks();
});

/** A terminal host on a fake PTY, with bash as the only shell. */
function fakeHost() {
  const spawner = new FakePtySpawner();
  const host: TerminalHost = {
    spawn: spawner.spawn,
    env: { HOME: '/home/runner', MWC_RUNNER_HOLD: 'none' },
    home: '/home/runner',
    platform: 'linux',
    exists: (path) => path === '/bin/bash',
  };
  return { spawner, host };
}

describe("the runner's terminals on the wire", () => {
  it('announces caps.terminal, opens a shell on terminal.open and carries its bytes both ways', async () => {
    const server = await fakeServer();
    const { spawner, host } = fakeHost();
    const { time } = startRunner(server, { terminal: host });
    expect((await server.frames.next('runner.hello')).caps.terminal).toBe(true);
    await server.frames.next('runner.heartbeat');
    const sessionId = newId();
    server.send({ type: 'terminal.open', sessionId, cols: 100, rows: 30 });
    expect(await server.frames.next('terminal.opened')).toEqual({
      type: 'terminal.opened',
      sessionId,
      shell: '/bin/bash',
    });
    expect(spawner.spawned[0]?.options.env).toEqual({
      HOME: '/home/runner',
      TERM: 'xterm-256color',
      LANG: 'C.UTF-8',
    });
    server.send({ type: 'terminal.input', sessionId, data: Buffer.from('whoami\r').toString('base64') });
    await vi.waitFor(() => expect(spawner.pty().input).toBe('whoami\r'));
    spawner.pty().print('runner\r\n');
    await time.advance(16);
    const output = await server.frames.next('terminal.output');
    expect(Buffer.from(output.data, 'base64').toString()).toBe('runner\r\n');
    server.send({ type: 'terminal.close', sessionId });
    expect(await server.frames.next('terminal.exit')).toEqual({
      type: 'terminal.exit',
      sessionId,
      code: null,
      signal: 'SIGHUP',
    });
  });

  it('has no terminal without a PTY, and says so to every open', async () => {
    const server = await fakeServer();
    startRunner(server);
    expect((await server.frames.next('runner.hello')).caps.terminal).toBe(false);
    await server.frames.next('runner.heartbeat');
    const sessionId = newId();
    server.send({ type: 'terminal.open', sessionId, cols: 80, rows: 24 });
    expect(await server.frames.next('terminal.exit')).toEqual({
      type: 'terminal.exit',
      sessionId,
      code: null,
      error: 'terminal_unavailable',
    });
  });

  it('holds the machine while a terminal is open, as live work, and lets go when the last one ends', async () => {
    const server = await fakeServer();
    const { spawner, host } = fakeHost();
    const { runner, time } = startRunner(server, { terminal: host });
    await server.frames.next('runner.heartbeat');
    await server.frames.next('hold.state');
    server.send({ type: 'terminal.open', sessionId: newId(), cols: 80, rows: 24 });
    expect(await server.frames.next('hold.state')).toEqual({
      type: 'hold.state',
      until: time.now() + LIVE_RUNS_HOLD_MS,
      source: 'live_runs',
    });
    expect(runner.status().liveRuns).toBe(0);
    spawner.pty().exit(0);
    expect(await server.frames.next('hold.state')).toEqual({
      type: 'hold.state',
      until: null,
      source: 'live_runs',
    });
  });

  it('ends its terminals when the link drops', async () => {
    const server = await fakeServer();
    const { spawner, host } = fakeHost();
    startRunner(server, { terminal: host });
    await server.frames.next('runner.heartbeat');
    server.send({ type: 'terminal.open', sessionId: newId(), cols: 80, rows: 24 });
    await server.frames.next('terminal.opened');
    server.dropAll();
    await vi.waitFor(() => expect(spawner.pty().signals).toEqual(['SIGHUP']));
  });

  it('ends its terminals when it stops, telling the server before the socket closes', async () => {
    const server = await fakeServer();
    const { host } = fakeHost();
    const { runner } = startRunner(server, { terminal: host });
    await server.frames.next('runner.heartbeat');
    const sessionId = newId();
    server.send({ type: 'terminal.open', sessionId, cols: 80, rows: 24 });
    await server.frames.next('terminal.opened');
    await runner.stop();
    expect(await server.frames.next('terminal.exit')).toEqual({
      type: 'terminal.exit',
      sessionId,
      code: null,
      signal: 'SIGHUP',
      error: 'runner_stopping',
    });
  });
});
