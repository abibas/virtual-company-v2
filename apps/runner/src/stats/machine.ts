import { CONTAINER_MARKER } from '../enroll/facts.ts';
import type { Log } from '../log.ts';
import type { Spawn } from '../system/process.ts';
import type { Clock, Timers } from '../system/time.ts';
import { CgroupStats } from './cgroup.ts';
import { createMemoryReader, type MemoryDeps } from './memory.ts';
import { type DiskStats, Sampler, type SamplerOs } from './sampler.ts';

/**
 * The daemon's sampler for this machine (`start.ts`): Node's `os` and `fs`, the memory reading of its system, and in a
 * container its cgroup's limits (`cgroup.ts`).
 */

export interface MachineSamplerDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly platform: NodeJS.Platform;
  readonly os: SamplerOs & MemoryDeps['os'];
  readonly fs: {
    exists(path: string): boolean;
    readFile(path: string): Promise<string>;
    statfs(path: string): Promise<DiskStats>;
  };
  readonly spawn: Spawn;
  readonly clock: Clock;
  readonly timers: Timers;
}

/** A Linux runner in a container (MWC_RUNNER_IN_CONTAINER=1, as the image sets, or Docker's marker file). */
export const inContainer = (
  deps: Pick<MachineSamplerDeps, 'platform' | 'env'> & {
    readonly fs: Pick<MachineSamplerDeps['fs'], 'exists'>;
  },
): boolean =>
  deps.platform === 'linux' && (deps.env.MWC_RUNNER_IN_CONTAINER === '1' || deps.fs.exists(CONTAINER_MARKER));

/** The sampler of the home folder's machine, measured against the container's own limits in a container. */
export function machineSampler(deps: MachineSamplerDeps, home: string, log: Log): Sampler {
  const { clock, fs } = deps;
  const memory = createMemoryReader({ ...deps, readFile: fs.readFile, log });
  const cgroup = inContainer(deps) ? new CgroupStats({ readFile: fs.readFile, clock }) : undefined;
  return new Sampler({
    os: deps.os,
    statfs: fs.statfs,
    home,
    memory,
    ...(cgroup ? { cgroup } : {}),
    clock,
    log,
  });
}
