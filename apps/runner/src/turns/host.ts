import type { HarnessDriver } from '@mwc/harness-core';
import type { Harness } from '@mwc/shared/enums';
import type { HarnessVersions } from '@mwc/shared/runner-protocol';
import type { ArtifactFs } from './artifacts/collect.ts';
import type { AskHost } from './ask/bridge.ts';
import type { Env } from './env.ts';
import type { PrivateDirs } from './private-dir.ts';
import type { ReadAt } from './runs/journal.ts';
import type { KeeperCommand } from './runs/kept.ts';

/** What a runner that runs harnesses has: the drivers of the CLIs it found, their versions, and what a turn needs. */
export interface HarnessHost {
  /** The drivers of the harnesses whose CLI is installed here. */
  readonly drivers: Partial<Record<Harness, HarnessDriver>>;
  /** Each CLI's version (`caps.harnesses`), null for a missing one. */
  readonly versions: HarnessVersions;
  /** The runner's environment, which a process gets less `MWC_*` and the driver's `unsetEnv`. */
  readonly env: Env;
  /** The private folders, shared by turns and terminals. */
  readonly dirs: PrivateDirs;
  /** Whether the agent's folder is there. */
  isDirectory(path: string): boolean;
  /**
   * A container runner's: makes an agent's home folder that is not there yet, under its work volume, before the turn
   * (`folders/mkdirp.ts`); true once it is there, and it never throws. Left out elsewhere: a missing one is `home_missing`.
   */
  makeHome?(path: string): Promise<boolean>;
  /** Where the turns' run folders are (`<state>/runs`, S5.4). */
  readonly runs: string;
  /** Reads a file from an offset (a turn's output). */
  readonly readAt: ReadAt;
  /** How a turn's keeper starts (`<node> <runner.mjs> keep`); without it no turn runs (`unsupported`). */
  readonly keeper?: KeeperCommand;
  /** The runner's tools (its MCP server and each turn's question socket); left out, turns run without them. */
  readonly ask?: AskHost;
  /** A task step's outputs folder (S5.3b); left out, a turn's `artifacts` is passed over and nothing is collected. */
  readonly artifacts?: ArtifactFs;
  /** Its git hooks' folder (S7.1d, `git/hooks.ts`) for a turn with a GitHub sign-in; left out, no turn gets one. */
  readonly gitHooks?: string;
  /**
   * Looks for a harness that has no driver again (no process unless its CLI is found now, then its `--version`); true
   * once it has one. Left out: a missing harness stays missing.
   */
  findAgain?(harness: Harness): Promise<boolean>;
}
