import { ClaudeCodeDriver } from '@mwc/harness-claude-code';
import { CodexDriver } from '@mwc/harness-codex';
import type { HarnessDriver } from '@mwc/harness-core';
import type { Harness } from '@mwc/shared/enums';
import type { HarnessVersions } from '@mwc/shared/runner-protocol';
import type { Log } from '../system/log.ts';
import type { Env } from './env.ts';
import { PrivateDirs, type PrivateFs } from './private-dir.ts';
import type { HarnessHost } from './turns.ts';

/**
 * The harnesses a runner runs: one driver per CLI it found (on its PATH or in the usual folders, `system/find-cli.ts`)
 * and that answered `--version` when the runner started (`cli.ts` asks each once), started by its full path. A CLI that
 * is missing or does not answer is a harness this runner does not have (`caps.harnesses` null, its turns `unsupported`)
 * until a turn or a terminal finds it again.
 */

/** A harness's CLI as the runner found it: its path and the version it printed. */
export interface HarnessCli {
  readonly path: string;
  readonly version: string;
}

/** The CLIs found, by harness. */
export type HarnessClis = Partial<Record<Harness, HarnessCli>>;

/** The name each harness's CLI has on the PATH. */
export const HARNESS_COMMANDS: Readonly<Record<Harness, string>> = { claude_code: 'claude', codex: 'codex' };

/** The drivers of the CLIs found. */
export function harnessDrivers(clis: HarnessClis): Partial<Record<Harness, HarnessDriver>> {
  return {
    ...(clis.claude_code ? { claude_code: new ClaudeCodeDriver({ command: clis.claude_code.path }) } : {}),
    ...(clis.codex ? { codex: new CodexDriver({ command: clis.codex.path }) } : {}),
  };
}

/** What the hello says of each harness: its version, null without its CLI. */
export function harnessVersions(clis: HarnessClis): HarnessVersions {
  return { claude_code: clis.claude_code?.version ?? null, codex: clis.codex?.version ?? null };
}

/** Finds a harness's CLI again and asks its version (`install/enroll/facts.ts`'s `harnessCli`). */
export type FindHarness = (harness: Harness) => Promise<HarnessCli | undefined>;

/**
 * The harnesses the daemon runs (`daemon/start.ts`): the CLIs `cli.ts` found, their drivers, and the private folders
 * under the state folder; logged by version, never an environment value. With `find`, a harness that was missing is
 * looked for again when a turn or a terminal needs it (no process unless it is found now): a CLI installed since the
 * runner started is then driven, and its version goes in the next hello.
 */
export function harnessHost(
  machine: {
    readonly clis: HarnessClis;
    readonly env: Env;
    readonly fs: PrivateFs;
    readonly stateDir: string;
    readonly find?: FindHarness | undefined;
  },
  log: Log,
): HarnessHost {
  const clis: HarnessClis = { ...machine.clis };
  const drivers = harnessDrivers(clis);
  const searches = new Map<Harness, Promise<boolean>>();
  const { find } = machine;
  log.info('harnesses', harnessVersions(clis));
  const search = async (harness: Harness, using: FindHarness): Promise<boolean> => {
    const cli = await using(harness);
    searches.delete(harness);
    if (cli === undefined) return false;
    clis[harness] = cli;
    Object.assign(drivers, harnessDrivers({ [harness]: cli }));
    log.info('harness found', { harness, version: cli.version });
    return true;
  };
  return {
    drivers,
    get versions() {
      return harnessVersions(clis);
    },
    env: machine.env,
    dirs: new PrivateDirs({ fs: machine.fs, stateDir: machine.stateDir }),
    isDirectory: (path) => machine.fs.isDirectory(path),
    ...(find === undefined
      ? {}
      : {
          findAgain: (harness: Harness) => {
            if (drivers[harness] !== undefined) return Promise.resolve(true);
            const running = searches.get(harness) ?? search(harness, find);
            searches.set(harness, running);
            return running;
          },
        }),
  };
}
