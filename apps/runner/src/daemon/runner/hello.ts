import {
  type HarnessVersions,
  type HeldTurn,
  RUNNER_PROTOCOL_VERSION,
  type RunnerCaps,
  type RunnerHello,
  type RunnerTools,
} from '@mwc/shared/runner-protocol';
import type { PowerExecutor } from '../../power/executor.ts';
import type { RunnerOptions } from '../runner.ts';

/**
 * The runner's `runner.hello` (docs/runner-protocol.md, "Connection"): its version, when its bundle was built (null from
 * the sources) and what it can do, with Claude Code's version and its build when it knows them (a runner that leaves
 * them out keeps what the server has on record), and the turns it holds (S5.4; left out when none).
 */

/** Without harnesses (no CLI found, or no way to start a process): neither one. */
export const NO_HARNESSES: HarnessVersions = { claude_code: null, codex: null };

export interface HelloFacts {
  readonly version: string;
  readonly builtAt: string | null;
  readonly caps: RunnerCaps;
  readonly claudeVersion?: string | null | undefined;
  readonly build?: string | null | undefined;
  readonly turns?: readonly HeldTurn[] | undefined;
}

export function helloOf({ version, builtAt, caps, claudeVersion, build, turns }: HelloFacts): RunnerHello {
  return {
    type: 'runner.hello',
    protocol: RUNNER_PROTOCOL_VERSION,
    version,
    builtAt,
    caps,
    ...(claudeVersion === undefined ? {} : { claudeVersion }),
    ...(build === undefined ? {} : { build }),
    ...(turns === undefined || turns.length === 0 ? {} : { turns: [...turns] }),
  };
}

/** What the daemon's parts can do now, beside its options. */
export interface CapsNow {
  readonly slots: number;
  readonly power: PowerExecutor['providers'];
  readonly terminal: boolean;
  readonly selfUpdate: boolean;
  readonly tools: RunnerTools | undefined;
}

/** What it can do now (the hello's and `runner.caps`'s). */
export function capsOf(options: RunnerOptions, now: CapsNow): RunnerCaps {
  const { harness, processes, containerId } = options;
  const { tools } = now;
  return {
    harnesses: harness && processes ? harness.versions : NO_HARNESSES,
    slots: now.slots,
    hold: options.hold.kind,
    power: [...now.power],
    terminal: now.terminal,
    selfUpdate: now.selfUpdate,
    folders: options.folders !== undefined,
    mkdirp: options.folders !== undefined,
    forks: true,
    reattach: harness?.keeper !== undefined && processes !== undefined,
    agentTools: harness?.ask !== undefined && processes !== undefined,
    serverTools: harness?.ask !== undefined && processes !== undefined,
    ...(tools ? { tools } : {}),
    ...(containerId ? { containerId } : {}),
  };
}
