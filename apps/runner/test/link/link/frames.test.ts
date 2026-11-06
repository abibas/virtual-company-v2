import { newId } from '@mwc/shared/ids';
import type { RunnerFrame } from '@mwc/shared/runner-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanUpLinks, fakeServer, startLink } from '../../fixtures/link.ts';
import { settle } from '../../fixtures/time.ts';

afterEach(cleanUpLinks);

describe('server frames', () => {
  it('hands each frame after the handshake to the commands and sends their answers back', async () => {
    const server = await fakeServer();
    const { handled } = startLink(server.url);
    await server.frames.next('runner.heartbeat');
    const cmdId = newId();
    server.send({ type: 'machine.hold', cmdId, until: 1_800_000 });
    expect(await server.frames.next('cmd.ack')).toEqual({ type: 'cmd.ack', cmdId, ok: true });
    server.send({ type: 'run.ack', runId: newId(), ackedSeq: 1 });
    await vi.waitFor(() => expect(handled.map((frame) => frame.type)).toEqual(['machine.hold', 'run.ack']));
  });

  it('refuses unknown and invalid commands with their reason, and ignores a second server.hello', async () => {
    const server = await fakeServer();
    const { handled, logs } = startLink(server.url);
    await server.frames.next('runner.heartbeat');
    const unknown = newId();
    server.sendRaw(JSON.stringify({ type: 'run.future', cmdId: unknown }));
    expect(await server.frames.next('cmd.ack')).toEqual({
      type: 'cmd.ack',
      cmdId: unknown,
      ok: false,
      error: 'unknown command run.future',
    });
    const invalid = newId();
    server.sendRaw(JSON.stringify({ type: 'machine.hold', cmdId: invalid }));
    const refused = await server.frames.next('cmd.ack');
    expect(refused).toMatchObject({ cmdId: invalid, ok: false });
    expect(refused.error).toContain('Invalid machine.hold frame');
    expect(logs.messages('warn')).toContain('an invalid frame from the server');
    server.send({ type: 'server.hello', protocol: 1, minRunnerVersion: '0.0.0', machineId: newId() });
    server.send({ type: 'runner.drain', cmdId: newId() });
    await server.frames.next('cmd.ack');
    expect(handled.map((frame) => frame.type)).toEqual(['runner.drain']);
    expect(server.frames.of('runner.resync')).toHaveLength(1);
  });

  it('ignores commands that come before server.hello', async () => {
    const server = await fakeServer({ hello: false });
    const { handled, logs } = startLink(server.url);
    await server.frames.next('runner.hello');
    server.send({ type: 'runner.drain', cmdId: newId() });
    await vi.waitFor(() => expect(logs.messages('warn')).toContain('a frame before server.hello; ignored'));
    expect(handled).toEqual([]);
  });

  it('logs a command that fails, and keeps going', async () => {
    const server = await fakeServer();
    const { logs } = startLink(server.url, { handle: async () => Promise.reject(new Error('disk full')) });
    await server.frames.next('runner.heartbeat');
    server.send({ type: 'runner.drain', cmdId: newId() });
    await vi.waitFor(() =>
      expect(logs.entries.at(-1)).toMatchObject({
        msg: 'a server frame failed',
        type: 'runner.drain',
        error: 'disk full',
      }),
    );
  });
});

describe('what the runner sends', () => {
  it('goes on beating when a heartbeat cannot be made', async () => {
    const server = await fakeServer();
    let calls = 0;
    const { time, logs } = startLink(server.url, {
      beat: async (): Promise<RunnerFrame[]> => {
        calls += 1;
        if (calls === 1) throw new Error('sampler broke');
        return [
          { type: 'runner.heartbeat', awakeMs: 1, load1: 0, liveRuns: [], backlog: 0, now: time.now() },
        ];
      },
    });
    await server.frames.next('hold.state');
    await vi.waitFor(() => expect(logs.messages('error')).toEqual(['cannot make a heartbeat']));
    await server.ping();
    await time.advance(20_000);
    await server.frames.next('runner.heartbeat');
  });

  it('drops a heartbeat whose socket closed while it was being made', async () => {
    const server = await fakeServer();
    let release: () => void = () => {};
    const { time, reconnectScheduled } = startLink(server.url, {
      beat: async (): Promise<RunnerFrame[]> => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return [
          { type: 'runner.heartbeat', awakeMs: 1, load1: 0, liveRuns: [], backlog: 0, now: time.now() },
        ];
      },
    });
    await server.frames.next('hold.state');
    server.dropAll();
    await reconnectScheduled(1);
    release();
    await settle();
    expect(server.frames.of('runner.heartbeat')).toEqual([]);
    expect(time.pending).toEqual([1_000]);
  });

  it('logs a frame too large to send instead of sending it, and sends frames only while connected', async () => {
    const server = await fakeServer();
    const huge = { type: 'runner.resync', runs: [], padding: 'x'.repeat(300_000) } as RunnerFrame;
    const { link, logs } = startLink(server.url, { afterHello: () => [huge] });
    await server.frames.next('runner.heartbeat');
    expect(logs.entries.find((entry) => entry.msg === 'cannot send a frame')).toMatchObject({
      type: 'runner.resync',
    });
    expect(server.frames.of('runner.resync')).toEqual([]);
    expect(link.send({ type: 'hold.state', until: 5, source: 'server' })).toBe(true);
    expect(await server.frames.next('hold.state')).toEqual({
      type: 'hold.state',
      until: 5,
      source: 'server',
    });
    expect(link.send(huge)).toBe(false);
  });
});
