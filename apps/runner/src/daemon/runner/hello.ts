import {
  type HarnessVersions,
  RUNNER_PROTOCOL_VERSION,
  type RunnerCaps,
  type RunnerHello,
} from '@mwc/shared/runner-protocol';

/**
 * The runner's `runner.hello` (docs/runner-protocol.md, "Connection"): its version and what it can do, with Claude
 * Code's version and its build when it knows them (a runner that leaves them out keeps what the server has on record).
 */

/** Without harnesses (no CLI found, or no way to start a process): neither one. */
export const NO_HARNESSES: HarnessVersions = { claude_code: null, codex: null };

export interface HelloFacts {
  readonly version: string;
  readonly caps: RunnerCaps;
  readonly claudeVersion?: string | null | undefined;
  readonly build?: string | null | undefined;
}

export function helloOf({ version, caps, claudeVersion, build }: HelloFacts): RunnerHello {
  return {
    type: 'runner.hello',
    protocol: RUNNER_PROTOCOL_VERSION,
    version,
    caps,
    ...(claudeVersion === undefined ? {} : { claudeVersion }),
    ...(build === undefined ? {} : { build }),
  };
}
