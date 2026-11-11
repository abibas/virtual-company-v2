import { join } from 'node:path';
import { ClaudeCodeDriver } from '@mwc/harness-claude-code';
import { CodexDriver, type RolloutFs } from '@mwc/harness-codex';
import type { HarnessDriver } from '@mwc/harness-core';
import type { Harness } from '@mwc/shared/enums';
import type { HarnessVersions } from '@mwc/shared/runner-protocol';
import type { Log } from '../system/log.ts';
import type { ArtifactFs } from './artifacts/collect.ts';
import { askHost } from './ask/bridge.ts';
import type { Env } from './env.ts';
import { PrivateDirs, type PrivateFs } from './private-dir.ts';
import { runsRoot } from './runs/folder.ts';
import type { KeeperCommand } from './runs/kept.ts';
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

/** The drivers of the CLIs found; with `rollouts`, Codex's turns end with its own context reading. */
export function harnessDrivers(
  clis: HarnessClis,
  rollouts?: RolloutFs,
): Partial<Record<Harness, HarnessDriver>> {
  return {
    ...(clis.claude_code ? { claude_code: new ClaudeCodeDriver({ command: clis.claude_code.path }) } : {}),
    ...(clis.codex
      ? { codex: new CodexDriver({ command: clis.codex.path, ...(rollouts ? { rollouts } : {}) }) }
      : {}),
  };
}

/** What the hello says of each harness: its version, null without its CLI. */
export function harnessVersions(clis: HarnessClis): HarnessVersions {
  return { claude_code: clis.claude_code?.version ?? null, codex: clis.codex?.version ?? null };
}

/** Finds a harness's CLI again and asks its version (`install/enroll/facts.ts`'s `harnessCli`). */
export type FindHarness = (harness: Harness) => Promise<HarnessCli | undefined>;

/** How a harness starts the runner's MCP server: `<node> <runner.mjs> mcp` (`cli.ts`). */
export interface ToolServer {
  readonly command: string;
  readonly args: readonly string[];
}

/** Where the turns' question sockets live: `<state>/turns/<12 hex>/` (docs/harness.md, "Asking the person"). */
export const turnsRoot = (stateDir: string) => join(stateDir, 'turns');

/**
 * The harnesses the daemon runs (`daemon/start.ts`): the CLIs `cli.ts` found, their drivers, and the private folders
 * under the state folder; logged by version, never an environment value. With `find`, a harness that was missing is
 * looked for again when a turn or a terminal needs it (no process unless it is found now): a CLI installed since the
 * runner started is then driven, and its version goes in the next hello. With `tools`, each turn gets the runner's MCP
 * server and its own question socket under the state folder. With `keeper`, turns run through it in run folders under
 * the state folder (S5.4); without it, none runs.
 */
export function harnessHost(
  machine: {
    readonly clis: HarnessClis;
    readonly env: Env;
    readonly fs: PrivateFs;
    readonly stateDir: string;
    readonly find?: FindHarness | undefined;
    readonly tools?: ToolServer | undefined;
    /** A task step's outputs folders (S5.3b). */
    readonly artifacts?: ArtifactFs | undefined;
    /** How a turn's keeper starts (`<node> <runner.mjs> keep`, S5.4). */
    readonly keeper?: KeeperCommand | undefined;
  },
  log: Log,
): HarnessHost {
  const clis: HarnessClis = { ...machine.clis };
  const drivers = harnessDrivers(clis, machine.fs);
  const searches = new Map<Harness, Promise<boolean>>();
  const { find } = machine;
  log.info('harnesses', harnessVersions(clis));
  const search = async (harness: Harness, using: FindHarness): Promise<boolean> => {
    const cli = await using(harness);
    searches.delete(harness);
    if (cli === undefined) return false;
    clis[harness] = cli;
    Object.assign(drivers, harnessDrivers({ [harness]: cli }, machine.fs));
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
    runs: runsRoot(machine.stateDir),
    readAt: (path, offset, bytes) => machine.fs.readAt(path, offset, bytes),
    ...(machine.keeper === undefined ? {} : { keeper: machine.keeper }),
    ...(machine.artifacts === undefined ? {} : { artifacts: machine.artifacts }),
    ...(machine.tools === undefined
      ? {}
      : { ask: askHost({ ...machine.tools, root: turnsRoot(machine.stateDir), log }) }),
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
