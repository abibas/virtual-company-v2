import { type DbHandle, tenant } from '@mwc/db';
import type { Logger } from 'pino';
import type { MachineUpkeep } from '../../../platform/jobs/run.ts';
import { pruneSamples, staleMachines } from '../repo/upkeep.ts';
import { MACHINE_LEASE_MS, PRUNE_INTERVAL_MS, SAMPLE_RETENTION_MS } from '../rules.ts';
import type { PowerControl } from './power/control.ts';
import { powerScheduler } from './power/scheduler.ts';
import type { RunnerHub } from './runner/hub.ts';
import { lapsed } from './runner/presence.ts';

/** How often the power scheduler decides. */
export const POWER_STEP_MS = 60_000;

/** Takes offline every machine whose lease lapsed at `now` while it was still marked online; returns how many. */
async function sweep(db: DbHandle, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - MACHINE_LEASE_MS);
  let offline = 0;
  for (const machine of await staleMachines(db, cutoff)) {
    if (await lapsed(await tenant(db, machine.companyId), machine.id, cutoff)) offline++;
  }
  return offline;
}

/**
 * The machines' share of the jobs loop (`moduleJobs` in app.ts), on every tick: the offline sweep (a machine still
 * marked online whose runner said nothing for 90 s, e.g. after a server crash), the prune of samples older than 7
 * days at most once an hour, and the power scheduler's step at most once a minute (`power/scheduler.ts`; it needs
 * the runner hub and the logger, so without them `power` is always null; with the configuration it also keeps the
 * devboxes' tunnels on the server's port, and with the app's power control it drives the devboxes the way the app
 * does). The first tick of a process prunes and steps; `pruned` and `power` are null on the ticks that do not.
 */
export function machineUpkeep(deps: {
  readonly db: DbHandle;
  readonly clock: () => Date;
  readonly logger?: Logger;
  readonly hub?: RunnerHub | undefined;
  readonly config?: { readonly MWC_PORT: number };
  readonly control?: PowerControl | undefined;
}): () => Promise<MachineUpkeep> {
  let nextPruneMs = Number.NEGATIVE_INFINITY;
  let nextPowerMs = Number.NEGATIVE_INFINITY;
  const { hub, logger } = deps;
  const port = deps.config?.MWC_PORT;
  const scheduler =
    hub === undefined || logger === undefined ? undefined : powerScheduler({ ...deps, hub, logger, port });
  return async () => {
    const now = deps.clock();
    const offline = await sweep(deps.db, now);
    let pruned: number | null = null;
    if (now.getTime() >= nextPruneMs) {
      nextPruneMs = now.getTime() + PRUNE_INTERVAL_MS;
      pruned = await pruneSamples(deps.db, new Date(now.getTime() - SAMPLE_RETENTION_MS));
    }
    if (scheduler === undefined || now.getTime() < nextPowerMs) return { offline, pruned, power: null };
    nextPowerMs = now.getTime() + POWER_STEP_MS;
    return { offline, pruned, power: await scheduler.step(now) };
  };
}
