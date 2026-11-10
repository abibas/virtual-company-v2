import { fakeTurnSpec } from '@mwc/harness-core/fake';
import { newId } from '@mwc/shared/ids';
import type {
  FsList,
  FsMkdir,
  PowerCommand,
  RunnerUpdate,
  ServerFrame,
  TerminalServerFrame,
  ToolsCheck,
  ToolsInstall,
  TunnelSpec,
  TurnServerFrame,
} from '@mwc/shared/runner-protocol';
import { describe, expect, it } from 'vitest';
import { Commands, NO_RUNS, REMEMBERED_COMMANDS } from '../../src/link/commands.ts';
import { NO_POWER, type PowerExecutor } from '../../src/power/executor.ts';
import { memoryLog } from '../fixtures/log.ts';
import { ROTATED_KEY } from '../fixtures/runner.ts';

function commands(options: { power?: PowerExecutor; saveKey?: (key: string) => void } = {}) {
  const holds: (number | null)[] = [];
  const keys: string[] = [];
  const tunnelSets: (readonly TunnelSpec[])[] = [];
  const terminals: TerminalServerFrame[] = [];
  const turns: TurnServerFrame[] = [];
  const updates: RunnerUpdate[] = [];
  const browsed: (FsList | FsMkdir)[] = [];
  const tooled: (ToolsCheck | ToolsInstall)[] = [];
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
    setTunnels: (tunnels) => void tunnelSets.push(tunnels),
    terminal: (frame) => void terminals.push(frame),
    turn: (frame) => void turns.push(frame),
    update: async (frame) => {
      updates.push(frame);
      return { type: 'runner.update.result', cmdId: frame.cmdId, ok: true, build: 'cd'.repeat(32) };
    },
    folders: async (frame) => {
      browsed.push(frame);
      const listing = frame.type === 'fs.list' ? { entries: [], truncated: false } : {};
      return { type: 'fs.result', cmdId: frame.cmdId, ok: true, path: '/w', ...listing };
    },
    tools: async (frame) => {
      tooled.push(frame);
      return { type: 'tools.result', cmdId: frame.cmdId, ok: true };
    },
    log: logs.log,
  });
  return {
    handler,
    holds,
    keys,
    tunnelSets,
    terminals,
    turns,
    updates,
    browsed,
    tooled,
    logs,
    drained: () => drained,
  };
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

  it('hands the terminal frames to the terminals, with no answer of its own', async () => {
    const { handler, terminals } = commands();
    const sessionId = newId();
    const frames: TerminalServerFrame[] = [
      { type: 'terminal.open', sessionId, cols: 80, rows: 24 },
      { type: 'terminal.close', sessionId },
    ];
    for (const frame of frames) expect(await handler.handle(frame)).toEqual([]);
    expect(terminals).toEqual(frames);
  });

  it('hands the turn frames to the turns, with no answer of its own', async () => {
    const { handler, turns } = commands();
    const turnId = newId();
    const frames: TurnServerFrame[] = [
      { type: 'turn.start', turnId, spec: fakeTurnSpec('claude_code') },
      { type: 'turn.stop', turnId },
    ];
    for (const frame of frames) expect(await handler.handle(frame)).toEqual([]);
    expect(turns).toEqual(frames);
  });

  it('hands tunnel.set to the tunnels as it comes, with no answer (it is no command)', async () => {
    const { handler, tunnelSets } = commands();
    const tunnel: TunnelSpec = {
      machineId: newId(),
      target: { provider: 'airia_devbox', ref: { instance: 'dev-ihor', zone: 'europe-west1-b' } },
      remotePort: 9950,
      localPort: 9950,
    };
    expect(await handler.handle({ type: 'tunnel.set', tunnels: [tunnel] })).toEqual([]);
    expect(await handler.handle({ type: 'tunnel.set', tunnels: [] })).toEqual([]);
    expect(tunnelSets).toEqual([[tunnel], []]);
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
      setTunnels: () => {},
      terminal: () => {},
      turn: () => {},
      update: async () => {
        throw new Error('no update in this test');
      },
      folders: async () => {
        throw new Error('no folders in this test');
      },
      tools: async () => {
        throw new Error('no tools in this test');
      },
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

  it("answers runner.update with the self-update's result, once per cmdId", async () => {
    const { handler, updates } = commands();
    const frame: RunnerUpdate = { type: 'runner.update', cmdId: newId() };
    const answer = { type: 'runner.update.result', cmdId: frame.cmdId, ok: true, build: 'cd'.repeat(32) };
    expect(await handler.handle(frame)).toEqual([answer]);
    expect(await handler.handle(frame)).toEqual([answer]);
    expect(updates).toEqual([frame]);
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
    expect(handler.refuse(JSON.stringify({ type: 'runner.update', cmdId: 7 }), 'invalid')).toEqual([]);
    expect(handler.refuse(JSON.stringify({ type: 'runner.update', cmdId, extra: 1 }), 'invalid')).toEqual([
      { type: 'runner.update.result', cmdId, ok: false, error: 'invalid' },
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

describe('the folder commands', () => {
  it('answers tools.check and tools.install with the tools’ tools.result, once per cmdId', async () => {
    const { handler, tooled } = commands();
    const check: ToolsCheck = { type: 'tools.check', cmdId: newId() };
    const install: ToolsInstall = {
      type: 'tools.install',
      cmdId: newId(),
      tool: 'codex',
      version: '0.163.0',
    };
    expect(await handler.handle(check)).toEqual([{ type: 'tools.result', cmdId: check.cmdId, ok: true }]);
    expect(await handler.handle(install)).toEqual([{ type: 'tools.result', cmdId: install.cmdId, ok: true }]);
    expect(await handler.handle(install)).toEqual([{ type: 'tools.result', cmdId: install.cmdId, ok: true }]);
    expect(tooled).toEqual([check, install]);
  });

  it('answers fs.list and fs.mkdir with the browser’s fs.result', async () => {
    const { handler, browsed } = commands();
    const list: FsList = { type: 'fs.list', cmdId: newId(), path: null };
    const made: FsMkdir = { type: 'fs.mkdir', cmdId: newId(), path: '/w/a' };
    expect(await handler.handle(list)).toEqual([
      { type: 'fs.result', cmdId: list.cmdId, ok: true, path: '/w', entries: [], truncated: false },
    ]);
    expect(await handler.handle(made)).toEqual([
      { type: 'fs.result', cmdId: made.cmdId, ok: true, path: '/w' },
    ]);
    expect(browsed).toEqual([list, made]);
  });

  it('reads a repeated listing again instead of keeping it, and answers a repeated mkdir from memory', async () => {
    const { handler, browsed } = commands();
    const list: FsList = { type: 'fs.list', cmdId: newId(), path: '/w' };
    const made: FsMkdir = { type: 'fs.mkdir', cmdId: newId(), path: '/w/a' };
    for (const frame of [list, list, made, made]) await handler.handle(frame);
    expect(browsed).toEqual([list, list, made]);
  });

  it('refuses a folder frame it cannot read with fs.result invalid_path', () => {
    const { handler } = commands();
    const cmdId = newId();
    for (const type of ['fs.list', 'fs.mkdir']) {
      expect(handler.refuse(JSON.stringify({ type, cmdId, path: 'x' }), 'path: an absolute path')).toEqual([
        { type: 'fs.result', cmdId, ok: false, error: 'invalid_path: path: an absolute path' },
      ]);
    }
  });
});
