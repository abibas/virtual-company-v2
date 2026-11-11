import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FAKE_HARNESS_BIN,
  FAKE_HARNESS_SCENARIO_ENV,
  FakeHarnessDriver,
  type FakeScenario,
  fakeLines,
} from '@mwc/harness-core/fake';
import type { TurnEvent } from '@mwc/shared/harness';
import type { TurnEnd, TurnEventItem, TurnQuestion, TurnRunnerFrame } from '@mwc/shared/runner-protocol';
import type { KillGroup } from '../../src/system/process.ts';
import { SYSTEM_CLOCK, SYSTEM_TIMERS, type Timers } from '../../src/system/time.ts';
import { nodePrivateFs } from '../../src/turns/files.ts';
import { PrivateDirs } from '../../src/turns/private-dir.ts';
import { runsRoot } from '../../src/turns/runs/folder.ts';
import { type HarnessHost, Turns } from '../../src/turns/turns.ts';
import { memoryLog } from './log.ts';
import { tempDir } from './runner.ts';

/**
 * Turns on real processes (S5.4's integration tests): the real keeper (`node src/main.ts keep`) starting the fake
 * harness binary (`FAKE_HARNESS_BIN`) on a scenario, in a temporary state folder and agent folder. Each `world()` is a
 * runner: a second one on the same machine is the runner after a restart.
 */

/** The runner's own entry, from its sources: `node src/main.ts keep …` is the keeper. */
export const MAIN_TS = fileURLToPath(new URL('../../src/main.ts', import.meta.url));

/** Signals a process group; quiet once it is gone. */
export const realKillGroup: KillGroup = (pid, signal) => {
  try {
    process.kill(-pid, signal);
  } catch {
    // Gone already.
  }
};

/** A machine: its state folder, an agent folder and a way to write scenarios. */
export function realMachine() {
  const root = tempDir();
  const cwd = join(root, 'agent');
  const stateDir = join(root, 'state');
  mkdirSync(cwd);
  let scenarios = 0;
  /** A fake harness driver playing `scenario` through the real binary. */
  const driver = (scenario: FakeScenario, options: { liveInput?: boolean } = {}) => {
    const file = join(root, `scenario-${++scenarios}.json`);
    writeFileSync(file, JSON.stringify(scenario));
    return new FakeHarnessDriver({
      command: process.execPath,
      args: [FAKE_HARNESS_BIN],
      env: { [FAKE_HARNESS_SCENARIO_ENV]: file },
      ...(options.liveInput ? { liveInput: true } : {}),
    });
  };
  return { root, cwd, stateDir, driver };
}

/** A runner's turns on that machine, with every frame they sent. */
export function realTurns(
  machine: Pick<ReturnType<typeof realMachine>, 'root' | 'stateDir'>,
  driver: FakeHarnessDriver,
  options: {
    readonly timers?: Timers;
    readonly online?: () => boolean;
    /** Sees each frame as it is sent (the chaos test's host prints them). */
    readonly onSend?: (frame: TurnRunnerFrame) => void;
  } = {},
) {
  const fs = nodePrivateFs();
  const logs = memoryLog();
  const host: HarnessHost = {
    drivers: { claude_code: driver },
    versions: { claude_code: '2.1.319 (Claude Code)', codex: null },
    env: { PATH: process.env.PATH, HOME: machine.root },
    dirs: new PrivateDirs({ fs, stateDir: machine.stateDir }),
    isDirectory: (path) => fs.isDirectory(path),
    runs: runsRoot(machine.stateDir),
    readAt: (path, offset, bytes) => fs.readAt(path, offset, bytes),
    keeper: { command: process.execPath, args: [MAIN_TS, 'keep'] },
  };
  const sent: TurnRunnerFrame[] = [];
  /** The signals the stop ladder sent, in order. */
  const signals: NodeJS.Signals[] = [];
  const killGroup: KillGroup = (pid, signal) => {
    signals.push(signal);
    realKillGroup(pid, signal);
  };
  const turns = new Turns({
    host,
    processes: { spawn, killGroup },
    slots: () => 4,
    clock: SYSTEM_CLOCK,
    timers: options.timers ?? SYSTEM_TIMERS,
    log: logs.log,
    send: (frame) => {
      sent.push(frame);
      options.onSend?.(frame);
      return options.online?.() ?? true;
    },
    count: () => undefined,
  });
  const events = (): TurnEventItem[] =>
    sent.flatMap((frame) => (frame.type === 'turn.events' ? frame.events : []));
  const ends = () => sent.filter((frame): frame is TurnEnd => frame.type === 'turn.end');
  const questions = () => sent.filter((frame): frame is TurnQuestion => frame.type === 'turn.question');
  return { turns, host, sent, signals, events, ends, questions, logs };
}

/** The lines of `count` text events, `one` … , then a result. */
export function countedLines(count: number, result = 'done'): string[] {
  const events: TurnEvent[] = Array.from({ length: count }, (_, i) => ({
    type: 'text',
    text: `line ${i + 1}`,
  }));
  return fakeLines([...events, { type: 'result', ok: true, text: result }]);
}
