import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import {
  FAKE_HARNESS_BIN,
  FAKE_HARNESS_SCENARIO_ENV,
  type FakeScenario,
  fakeInputLine,
} from '@mwc/harness-core/fake';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LineReader } from '../../../src/turns/lines.ts';
import { RUN_FILES } from '../../../src/turns/runs/folder.ts';
import { KEEPER_ORPHAN_MS, KEEPER_USAGE, keeperArgs, runKeeper } from '../../../src/turns/runs/keeper.ts';
import { nodeKeeperIo } from '../../../src/turns/runs/keeper-io.ts';
import { pidOf } from '../../../src/turns/runs/kept.ts';
import { tempDir } from '../../fixtures/runner.ts';
import { FakeTime } from '../../fixtures/time.ts';

/** A run folder with a fake harness scenario, and the keeper's argv for it. */
function runOf(scenario: FakeScenario) {
  const dir = join(tempDir(), 'run');
  mkdirSync(dir);
  const file = join(dir, 'scenario.json');
  writeFileSync(file, JSON.stringify(scenario));
  process.env[FAKE_HARNESS_SCENARIO_ENV] = file;
  return { dir, argv: [dir, '--', process.execPath, FAKE_HARNESS_BIN] };
}

const command = (value: object) => `${JSON.stringify(value)}\n`;
const exitOf = (dir: string) => JSON.parse(readFileSync(join(dir, RUN_FILES.exit), 'utf8'));
const read = (dir: string, file: 'out' | 'err') => readFileSync(join(dir, RUN_FILES[file]), 'utf8');

/** Connects to the keeper's socket and reads its greeting line. */
async function joinKeeper(dir: string) {
  const socket = connect(join(dir, RUN_FILES.socket));
  const reader = new LineReader();
  const greeting = await new Promise<string>((resolve, reject) => {
    socket.on('error', reject);
    socket.on('data', (chunk) => {
      const [line] = reader.push(chunk);
      if (line !== undefined) resolve(line);
    });
  });
  return { socket, greeting };
}

afterEach(() => {
  delete process.env[FAKE_HARNESS_SCENARIO_ENV];
});

describe('the keeper', () => {
  it('starts the harness with its output in the run folder, and writes its exit', async () => {
    const { dir, argv } = runOf({ lines: ['{"a":1}'], stderr: 'warn\n', exitCode: 3 });
    const stdin = new PassThrough();
    const signals: string[] = [];
    const running = runKeeper(nodeKeeperIo(argv, { stdin, onSignal: (signal) => void signals.push(signal) }));
    stdin.write(command({ w: 'the prompt' }));
    stdin.write(command({ end: true }));
    expect(await running).toBe(0);
    expect(read(dir, 'out')).toBe('{"a":1}\n');
    expect(read(dir, 'err')).toBe('warn\n');
    expect(exitOf(dir)).toEqual({ code: 3, signal: null });
    expect(signals).toEqual(['SIGINT', 'SIGTERM', 'SIGHUP']);
    expect(stdin.destroyed).toBe(true);
  });

  it('says why when the harness cannot start', async () => {
    const { dir } = runOf({ lines: [], exitCode: 0 });
    const io = nodeKeeperIo([dir, '--', join(dir, 'no-such-program')], {
      stdin: new PassThrough(),
      onSignal: () => {},
    });
    expect(await runKeeper(io)).toBe(0);
    expect(exitOf(dir)).toMatchObject({ code: null, signal: null, error: expect.stringContaining('ENOENT') });
    const throwing = nodeKeeperIo([dir, '--', 'x'], {
      stdin: new PassThrough(),
      onSignal: () => {},
      spawn: () => {
        throw new Error('no processes');
      },
    });
    expect(await runKeeper(throwing)).toBe(0);
    expect(exitOf(dir)).toEqual({ code: null, signal: null, error: 'no processes' });
  });

  it('refuses arguments that are not a run folder and a command', async () => {
    expect(keeperArgs(['/run'])).toBeUndefined();
    expect(keeperArgs(['/run', 'x', 'claude'])).toBeUndefined();
    expect(keeperArgs(['/run', '--'])).toBeUndefined();
    expect(keeperArgs(['/run', '--', 'claude', '-p'])).toEqual({
      dir: '/run',
      command: 'claude',
      args: ['-p'],
    });
    expect(await runKeeper(nodeKeeperIo([], { stdin: new PassThrough(), onSignal: () => {} }))).toBe(
      KEEPER_USAGE,
    );
  });

  it('greets a runner on its socket with its pid and takes its commands, keeping stdin open when its first line goes', async () => {
    const { dir, argv } = runOf({ lines: ['{"type":"result","ok":true}'], exitCode: 0, liveInput: true });
    const stdin = new PassThrough();
    const running = runKeeper(nodeKeeperIo(argv, { stdin, onSignal: () => {} }));
    stdin.write(command({ w: 'the prompt\n' }));
    stdin.write('not a command\n');
    stdin.end();
    await vi.waitFor(() => expect(read(dir, 'out')).toContain('result'));
    const runner = await joinKeeper(dir);
    expect(pidOf(runner.greeting)).toBe(process.pid);
    runner.socket.write(command({ w: fakeInputLine('Use staging', 'm-1') }));
    await vi.waitFor(() => expect(read(dir, 'out')).toContain('"inputId":"m-1"'));
    runner.socket.write(command({ end: true }));
    runner.socket.write(command({ w: 'too late' }));
    expect(await running).toBe(0);
    expect(exitOf(dir)).toEqual({ code: 0, signal: null });
  });

  it('closes the harness’s stdin when no runner has been on its line for long', async () => {
    const { dir, argv } = runOf({ lines: [], exitCode: 0, liveInput: true });
    const stdin = new PassThrough();
    const timers = new FakeTime();
    const running = runKeeper(nodeKeeperIo(argv, { stdin, onSignal: () => {}, timers }));
    stdin.write(command({ w: 'the prompt\n' }));
    stdin.end();
    await vi.waitFor(() => expect(timers.pending).toEqual([KEEPER_ORPHAN_MS]));
    const runner = await joinKeeper(dir);
    expect(timers.pending).toEqual([]);
    runner.socket.destroy();
    await vi.waitFor(() => expect(timers.pending).toEqual([KEEPER_ORPHAN_MS]));
    await timers.advance(KEEPER_ORPHAN_MS);
    expect(await running).toBe(0);
    expect(exitOf(dir)).toEqual({ code: 0, signal: null });
  });

  it('turns away a runner that connects as it ends', async () => {
    const { dir, argv } = runOf({ lines: [], exitCode: 0 });
    let connected: ((line: { destroy(): unknown; on(): unknown }) => void) | undefined;
    const destroyed: string[] = [];
    const stdin = new PassThrough();
    stdin.write(command({ end: true }));
    const running = runKeeper(
      nodeKeeperIo(argv, {
        stdin,
        onSignal: () => {},
        listen: (_path, onLine) => {
          connected = onLine as typeof connected;
          return { close: () => undefined };
        },
      }),
    );
    expect(pidOf('{"pid":0}')).toBeUndefined();
    expect(pidOf('nope')).toBeUndefined();
    await running;
    connected?.({ destroy: () => destroyed.push('late'), on: () => undefined });
    expect(destroyed).toEqual(['late']);
    expect(exitOf(dir)).toEqual({ code: 0, signal: null });
  });
});
