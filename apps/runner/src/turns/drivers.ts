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
 * The harnesses a runner runs: one driver per CLI it found on its PATH and that answered `--version` when the runner
 * started (`cli.ts` asks each once), started by its full path. A CLI that is missing or does not answer is a harness
 * this runner does not have (`caps.harnesses` null, its turns `unsupported`).
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

/**
 * The harnesses the daemon runs (`daemon/start.ts`): the CLIs `cli.ts` found, their drivers, and the private folders
 * under the state folder; logged by version, never an environment value.
 */
export function harnessHost(
  machine: {
    readonly clis: HarnessClis;
    readonly env: Env;
    readonly fs: PrivateFs;
    readonly stateDir: string;
  },
  log: Log,
): HarnessHost {
  const versions = harnessVersions(machine.clis);
  log.info('harnesses', versions);
  return {
    drivers: harnessDrivers(machine.clis),
    versions,
    env: machine.env,
    dirs: new PrivateDirs({ fs: machine.fs, stateDir: machine.stateDir }),
    isDirectory: (path) => machine.fs.isDirectory(path),
  };
}
