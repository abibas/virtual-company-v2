import { newId } from '@mwc/shared/ids';
import type { PowerCommand, ServerFrame } from '@mwc/shared/runner-protocol';
import { describe, expect, it } from 'vitest';
import { Commands, NO_RUNS, REMEMBERED_COMMANDS } from '../../src/link/commands.ts';
import { NO_POWER, type PowerExecutor } from '../../src/power.ts';
import { memoryLog } from '../fixtures/log.ts';
import { ROTATED_KEY } from '../fixtures/runner.ts';

function commands(options: { power?: PowerExecutor; saveKey?: (key: string) => void } = {}) {
  const holds: (number | null)[] = [];
  const keys: string[] = [];
  let drained = 0;
  const logs = memoryLog();
  const handler = new Commands({
    setServerHold: async (until) => {
      holds.push(until);
    },
    power: options.power ?? NO_POWER,
    saveKey: options.saveKey ?? ((key) => void keys.push(key)),
    drain: () => {
      drained += 1;
    },
    log: logs.log,
  });
  return { handler, holds, keys, logs, drained: () => drained };
}

const powerCommand = (): PowerCommand => ({
  type: 'power.command',
  cmdId: newId(),
  target: { provider: 'airia_devbox', ref: { instance: 'dev-ihor', zone: 'europe-west1-b' } },
  action: 'start',
});

describe('the commands', () => {
  it('applies machine.hold and acks it', async () => {
    const { handler, holds } = commands();
    const cmdId = newId();
    expect(await handler.handle({ type: 'machine.hold', cmdId, until: 1_800_000 })).toEqual([
      { type: 'cmd.ack', cmdId, ok: true },
    ]);
    await handler.handle({ type: 'machine.hold', cmdId: newId(), until: null });
    expect(holds).toEqual([1_800_000, null]);
  });

  it('answers power.command with power.result from the executor: no_power_driver by default', async () => {
    const cmd = powerCommand();
    expect(await commands().handler.handle(cmd)).toEqual([
      { type: 'power.result', cmdId: cmd.cmdId, ok: false, error: 'no_power_driver' },
    ]);
    const power: PowerExecutor = {
      providers: ['airia_devbox'],
      execute: async () => ({ ok: true, status: 'starting' }),
    };
    expect(await commands({ power }).handler.handle(cmd)).toEqual([
      { type: 'power.result', cmdId: cmd.cmdId, ok: true, status: 'starting' },
    ]);
  });

  it('saves a rotated key before acking it, and acks a failed save as not ok', async () => {
    const { handler, keys, logs } = commands();
    const cmdId = newId();
    expect(await handler.handle({ type: 'key.rotate', cmdId, runnerKey: ROTATED_KEY })).toEqual([
      { type: 'cmd.ack', cmdId, ok: true },
    ]);
    expect(keys).toEqual([ROTATED_KEY]);
    expect(logs.messages()).toEqual(['saved the rotated runner key']);
    const failing = commands({
      saveKey: () => {
        throw new Error('EACCES: runner.json');
      },
    });
    const other = newId();
    expect(
      await failing.handler.handle({ type: 'key.rotate', cmdId: other, runnerKey: ROTATED_KEY }),
    ).toEqual([{ type: 'cmd.ack', cmdId: other, ok: false, error: 'EACCES: runner.json' }]);
    expect(failing.logs.entries.at(-1)).toMatchObject({ msg: 'a command failed', type: 'key.rotate' });
    const odd = commands({
      saveKey: () => {
        throw 'not an error';
      },
    });
    const third = newId();
    expect(await odd.handler.handle({ type: 'key.rotate', cmdId: third, runnerKey: ROTATED_KEY })).toEqual([
      { type: 'cmd.ack', cmdId: third, ok: false, error: 'the command failed' },
    ]);
  });

  it('drains, refuses the run commands until runs exist, and declines offers', async () => {
    const { handler, drained } = commands();
    const drain = newId();
    expect(await handler.handle({ type: 'runner.drain', cmdId: drain })).toEqual([
      { type: 'cmd.ack', cmdId: drain, ok: true },
    ]);
    expect(drained()).toBe(1);
    const runId = newId();
    const stop = newId();
    expect(await handler.handle({ type: 'run.stop', cmdId: stop, runId, mode: 'graceful' })).toEqual([
      { type: 'cmd.ack', cmdId: stop, ok: false, error: NO_RUNS },
    ]);
    const offer = newId();
    expect(
      await handler.handle({ type: 'job.offer', id: offer, runId, agentId: newId(), expiresAt: 1_000 }),
    ).toEqual([{ type: 'job.decline', id: offer, runId, reason: NO_RUNS }]);
    expect(await handler.handle({ type: 'run.ack', runId, ackedSeq: 3 })).toEqual([]);
  });

  it('answers a repeated cmdId with the same answer without running it again, and ignores one still running', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holds: (number | null)[] = [];
    const handler = new Commands({
      setServerHold: async (until) => {
        holds.push(until);
        await gate;
      },
      power: NO_POWER,
      saveKey: () => {},
      drain: () => {},
      log: memoryLog().log,
    });
    const frame: ServerFrame = { type: 'machine.hold', cmdId: newId(), until: 5 };
    const first = handler.handle(frame);
    expect(await handler.handle(frame)).toEqual([]);
    release();
    expect(await first).toEqual([{ type: 'cmd.ack', cmdId: frame.cmdId, ok: true }]);
    expect(await handler.handle(frame)).toEqual([{ type: 'cmd.ack', cmdId: frame.cmdId, ok: true }]);
    expect(holds).toEqual([5]);
  });

  it(`remembers the last ${REMEMBERED_COMMANDS} answers`, async () => {
    const { handler, drained } = commands();
    const first = newId();
    await handler.handle({ type: 'runner.drain', cmdId: first });
    for (let i = 0; i < REMEMBERED_COMMANDS; i++)
      await handler.handle({ type: 'runner.drain', cmdId: newId() });
    await handler.handle({ type: 'runner.drain', cmdId: first });
    expect(drained()).toBe(REMEMBERED_COMMANDS + 2);
  });
});

describe('frames the runner cannot read', () => {
  it('acks an unknown or invalid command with its reason, so the server does not wait', () => {
    const { handler } = commands();
    const cmdId = newId();
    expect(
      handler.refuse(JSON.stringify({ type: 'run.future', cmdId }), 'unknown command run.future'),
    ).toEqual([{ type: 'cmd.ack', cmdId, ok: false, error: 'unknown command run.future' }]);
    expect(handler.refuse(JSON.stringify({ type: 'power.command', cmdId }), 'x'.repeat(3000))).toEqual([
      { type: 'power.result', cmdId, ok: false, error: 'x'.repeat(2000) },
    ]);
  });

  it('answers nothing without a cmdId that is a UUID, or for a text that is not JSON', () => {
    const { handler } = commands();
    expect(handler.refuse('{"type":"server.future"}', 'unknown')).toEqual([]);
    expect(handler.refuse('{"type":"run.future","cmdId":"abc"}', 'unknown')).toEqual([]);
    expect(handler.refuse('null', 'not an object')).toEqual([]);
    expect(handler.refuse('not json', 'not json')).toEqual([]);
  });
});
