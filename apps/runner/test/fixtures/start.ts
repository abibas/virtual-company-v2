import { join } from 'node:path';
import type { FakeRunnerServer } from '@mwc/testkit/runner';
import { expect, vi } from 'vitest';
import { WebSocket } from 'ws';
import { writeRunnerConfig } from '../../src/config.ts';
import type { MainDeps } from '../../src/daemon/start.ts';
import { nodeFoldersFs } from '../../src/folders/files.ts';
import { CAFFEINATE_BIN } from '../../src/hold/driver.ts';
import { nodePrivateFs } from '../../src/turns/files.ts';
import type { LogEntry } from './log.ts';
import { httpOf, runnerConfig, tempDir } from './runner.ts';
import { FakeSpawn } from './spawn.ts';
import { FakeTime } from './time.ts';

const cores = [{ times: { user: 1, nice: 0, sys: 1, idle: 8, irq: 0 } }];

/** A machine for `main`: Node's `os` and `fs` as the runner reads them, faked, with the folders it made. */
function fakeMachine(dir: string) {
  const mkdirs: string[] = [];
  const os: MainDeps['os'] = {
    loadavg: () => [0.5, 0.4, 0.3],
    cpus: () => cores,
    uptime: () => 100,
    freemem: () => 1,
    totalmem: () => 4,
    homedir: () => dir,
  };
  const fs: MainDeps['fs'] = {
    exists: (path) => path === CAFFEINATE_BIN,
    readFile: async () => 'MemTotal: 100 kB\nMemAvailable: 50 kB\n',
    statfs: async () => ({ bsize: 1, blocks: 10, bfree: 5 }),
    mkdir: (path) => {
      mkdirs.push(path);
    },
  };
  return { os, fs, mkdirs };
}

/** The process for `main`: captured log lines, signal handlers, exits and keep-alives. */
function fakeProcess() {
  const lines: string[] = [];
  const signals = new Map<string, () => void>();
  const exits: number[] = [];
  const keepAlive = { held: 0, released: 0 };
  const process: Pick<MainDeps, 'write' | 'onSignal' | 'exit' | 'keepAlive'> = {
    write: (line) => lines.push(line),
    onSignal: (signal, handler) => signals.set(signal, handler),
    exit: (code) => exits.push(code),
    keepAlive: () => {
      keepAlive.held += 1;
      return () => {
        keepAlive.released += 1;
      };
    },
  };
  return { process, lines, signals, exits, keepAlive };
}

export interface WorldOptions {
  readonly server?: FakeRunnerServer;
  readonly env?: Record<string, string | undefined>;
  readonly platform?: NodeJS.Platform;
  readonly power?: MainDeps['power'];
  /** The PTY the daemon loads; none (with a reason) by default. */
  readonly loadPty?: MainDeps['loadPty'];
  /** The harnesses' CLIs `cli.ts` found; none by default. */
  readonly harnesses?: MainDeps['harnesses'];
}

/** `main`'s outside world, faked: a config file in a temporary folder, fake time, a fake spawn, captured signals. */
export function world(options: WorldOptions = {}) {
  const dir = tempDir();
  const configPath = join(dir, 'runner.json');
  const server = options.server;
  const config = runnerConfig(server ? httpOf(server) : 'http://127.0.0.1:9', {
    ...(server ? { machineId: server.machineId } : {}),
  });
  writeRunnerConfig(configPath, config);
  const time = new FakeTime();
  const spawn = new FakeSpawn();
  const machine = fakeMachine(dir);
  const proc = fakeProcess();
  const deps: MainDeps = {
    env: {
      HOME: dir,
      MWC_RUNNER_CONFIG: configPath,
      MWC_RUNNER_STATE_DIR: join(dir, 'state'),
      MWC_RUNNER_HEALTH_PORT: '0',
      ...options.env,
    },
    platform: options.platform ?? 'linux',
    pid: 4242,
    os: machine.os,
    fs: machine.fs,
    privateFs: nodePrivateFs(),
    foldersFs: nodeFoldersFs(),
    spawn: spawn.spawn,
    killGroup: spawn.killGroup,
    WebSocket,
    clock: time,
    timers: time,
    random: () => 0,
    ...proc.process,
    version: '0.1.0',
    ...(options.power ? { power: options.power } : {}),
    ...(options.harnesses ? { harnesses: options.harnesses } : {}),
    loadPty: options.loadPty ?? (() => ({ ok: false, reason: 'no PTY in this test' })),
  };
  const entries = () => proc.lines.map((line) => JSON.parse(line) as LogEntry);
  const logged = (msg: string) =>
    vi.waitFor(() => expect(entries().map((entry) => entry.msg)).toContain(msg));
  return { deps, dir, configPath, time, spawn, entries, logged, mkdirs: machine.mkdirs, ...proc };
}
