import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId } from '@mwc/shared/ids';
import type { MachineSample } from '@mwc/shared/machines';
import type { FakeRunnerServer } from '@mwc/testkit/runner';
import type { RunnerConfig } from '../../src/config.ts';
import { createRunner, type Runner } from '../../src/daemon/runner.ts';
import type { HoldDriver, HoldDriverKind } from '../../src/hold/driver.ts';
import type { PowerExecutor } from '../../src/power/executor.ts';
import type { TerminalHost } from '../../src/terminal/sessions.ts';
import type { SelfUpdate } from '../../src/update/self-update.ts';
import { memoryLog } from './log.ts';
import type { FakeSpawn } from './spawn.ts';
import { FakeTime } from './time.ts';

export const RUNNER_KEY = `mwc_rk_${'A1b2C3d4'.repeat(4)}`;
export const ROTATED_KEY = `mwc_rk_${'Z9y8X7w6'.repeat(4)}`;

/** A valid configuration for a server address. */
export function runnerConfig(
  serverUrl = 'http://127.0.0.1:9950',
  overrides: Partial<RunnerConfig> = {},
): RunnerConfig {
  return { serverUrl, machineId: newId(), runnerKey: RUNNER_KEY, name: 'This Mac', slots: 2, ...overrides };
}

/** A new empty folder under the system's temporary folder. */
export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'mwc-runner-'));
}

/** The server address of a fake runner server (`http://127.0.0.1:<port>`). */
export const httpOf = (server: FakeRunnerServer) => `http://127.0.0.1:${server.port}`;

/** A sampler that counts its samples and stamps them with the fake time. */
export function fakeSampler(time: FakeTime) {
  const taken: number[] = [];
  return {
    taken,
    load1: () => 0.5,
    sample: async (liveRuns: number): Promise<MachineSample> => {
      taken.push(time.now());
      return {
        load1: 0.5,
        load5: 0.4,
        load15: 0.3,
        cpus: 8,
        cpuPct: 12.5,
        memPct: 40,
        diskUsed: 100,
        diskTotal: 1000,
        uptimeS: 3600,
        liveRuns,
        at: time.now(),
      };
    },
  };
}

/** A hold driver that records what it is asked and guarantees what it is given. */
export function recordingDriver(kind: HoldDriverKind = 'none') {
  const calls: { step: 'apply' | 'refresh' | 'close'; until?: number | null }[] = [];
  const driver: HoldDriver = {
    kind,
    apply: async (until) => {
      calls.push({ step: 'apply', until });
      return until;
    },
    refresh: async (until) => {
      calls.push({ step: 'refresh', until });
      return until;
    },
    close: async () => {
      calls.push({ step: 'close' });
    },
  };
  return { driver, calls };
}

export interface StartedRunner {
  readonly runner: Runner;
  readonly time: FakeTime;
  readonly config: RunnerConfig;
  readonly logs: ReturnType<typeof memoryLog>;
  readonly sampler: ReturnType<typeof fakeSampler>;
  readonly hold: ReturnType<typeof recordingDriver>;
  readonly saved: RunnerConfig[];
}

const started: Runner[] = [];

/** A runner on fake time against a fake server, started; `stopRunners()` stops them all (afterEach). */
export function startRunner(
  server: FakeRunnerServer,
  options: {
    power?: PowerExecutor;
    /** Starts and stops the tunnels of a runner with `power`. */
    spawn?: FakeSpawn;
    random?: () => number;
    saveFails?: boolean;
    config?: Partial<RunnerConfig>;
    /** Opens terminals through this host (a fake PTY). */
    terminal?: TerminalHost;
    /** The build it says it runs, and how it updates itself. */
    build?: string | null;
    update?: SelfUpdate;
  } = {},
): StartedRunner {
  const time = new FakeTime();
  const logs = memoryLog(() => time.now());
  const sampler = fakeSampler(time);
  const hold = recordingDriver();
  const config = runnerConfig(httpOf(server), { machineId: server.machineId, ...options.config });
  const saved: RunnerConfig[] = [];
  const runner = createRunner({
    config,
    version: '0.1.0',
    log: logs.log,
    hold: hold.driver,
    sampler,
    ...(options.power ? { power: options.power } : {}),
    ...(options.spawn
      ? { processes: { spawn: options.spawn.spawn, killGroup: options.spawn.killGroup } }
      : {}),
    ...(options.terminal ? { terminal: options.terminal } : {}),
    ...(options.build === undefined ? {} : { build: options.build }),
    ...(options.update ? { update: options.update } : {}),
    saveConfig: (next) => {
      if (options.saveFails) throw new Error('disk full');
      saved.push(next);
    },
    clock: time,
    timers: time,
    random: options.random ?? (() => 0),
  });
  started.push(runner);
  runner.start();
  return { runner, time, config, logs, sampler, hold, saved };
}

export async function stopRunners(): Promise<void> {
  await Promise.all(started.splice(0).map((runner) => runner.stop()));
}
