import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { HarnessDriver } from '@mwc/harness-core';
import { FakeHarnessDriver, type FakeHarnessDriverOptions, fakeLines } from '@mwc/harness-core/fake';
import type { Harness } from '@mwc/shared/enums';
import type { TurnEvent } from '@mwc/shared/harness';
import type { TurnEnd, TurnEventItem, TurnRunnerFrame } from '@mwc/shared/runner-protocol';
import { nodePrivateFs } from '../../src/turns/files.ts';
import { PrivateDirs } from '../../src/turns/private-dir.ts';
import { runsRoot } from '../../src/turns/runs/folder.ts';
import { type HarnessHost, Turns } from '../../src/turns/turns.ts';
import { memoryLog } from './log.ts';
import { tempDir } from './runner.ts';
import { FAKE_KEEPER, FakeSpawn } from './spawn.ts';
import { FakeTime } from './time.ts';

/** The program the fake drivers name; the fake spawn plays it. */
export const FAKE_COMMAND = 'fake-harness';

/** A harness host on fake drivers, a temporary agent folder (`cwd`) and state folder, and the real file system. */
export function fakeHarnessHost(
  options: {
    readonly drivers?: Partial<Record<Harness, HarnessDriver>>;
    readonly driver?: FakeHarnessDriverOptions;
    readonly env?: Record<string, string | undefined>;
  } = {},
) {
  const root = tempDir();
  const cwd = join(root, 'agent');
  const stateDir = join(root, 'state');
  mkdirSync(cwd);
  const fs = nodePrivateFs();
  const driver = new FakeHarnessDriver({ command: FAKE_COMMAND, ...options.driver });
  const host: HarnessHost = {
    drivers: options.drivers ?? { claude_code: driver },
    versions: { claude_code: '2.1.319 (Claude Code)', codex: null },
    env: options.env ?? { PATH: '/usr/bin', HOME: root },
    dirs: new PrivateDirs({ fs, stateDir }),
    isDirectory: (path) => fs.isDirectory(path),
    runs: runsRoot(stateDir),
    readAt: (path, offset, bytes) => fs.readAt(path, offset, bytes),
    keeper: { command: FAKE_KEEPER, args: [] },
  };
  return { host, driver, root, cwd, stateDir };
}

/** The stdout lines of a turn that answers `text`: its session, the text, its usage and its result. */
export function answerLines(text = '4'): string {
  const events: TurnEvent[] = [
    { type: 'session', sessionId: 'session-1' },
    { type: 'text', text },
    { type: 'result', ok: true, text },
  ];
  return `${fakeLines(events).join('\n')}\n`;
}

/** The turns of a runner on fake time and a fake spawn, with every frame they sent and each count of live turns. */
export function turnsWorld(
  options: {
    readonly host?: HarnessHost | undefined;
    readonly slots?: number;
    readonly processes?: boolean;
    /** Whether the link is up: a frame sent while it is down is kept but `send` says false. */
    readonly online?: () => boolean;
  } = {},
) {
  const time = new FakeTime();
  const logs = memoryLog(() => time.now());
  const spawn = new FakeSpawn();
  const sent: TurnRunnerFrame[] = [];
  const counts: number[] = [];
  const turns = new Turns({
    host: options.host,
    processes: options.processes === false ? undefined : { spawn: spawn.spawn, killGroup: spawn.killGroup },
    slots: () => options.slots ?? 2,
    clock: time,
    timers: time,
    log: logs.log,
    send: (frame) => {
      sent.push(frame);
      return options.online?.() ?? true;
    },
    count: (live) => void counts.push(live),
  });
  const ends = () => sent.filter((frame): frame is TurnEnd => frame.type === 'turn.end');
  const events = (): TurnEventItem[] =>
    sent.flatMap((frame) => (frame.type === 'turn.events' ? frame.events : []));
  return { turns, time, logs, spawn, sent, counts, ends, events };
}
