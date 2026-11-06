import { type DbHandle, tenant } from '@mwc/db';
import type { MachineUpkeep } from '../../../platform/jobs/run.ts';
import { pruneSamples, staleMachines } from '../repo/upkeep.ts';
import { MACHINE_LEASE_MS, PRUNE_INTERVAL_MS, SAMPLE_RETENTION_MS } from '../rules.ts';
import { lapsed } from './presence.ts';

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
 * marked online whose runner said nothing for 90 s, e.g. after a server crash), and the prune of samples older than 7
 * days, at most once an hour (the first tick of a process prunes; `pruned` is null on the ticks that do not).
 */
export function machineUpkeep(deps: {
  readonly db: DbHandle;
  readonly clock: () => Date;
}): () => Promise<MachineUpkeep> {
  let nextPruneMs = Number.NEGATIVE_INFINITY;
  return async () => {
    const now = deps.clock();
    const offline = await sweep(deps.db, now);
    if (now.getTime() < nextPruneMs) return { offline, pruned: null };
    nextPruneMs = now.getTime() + PRUNE_INTERVAL_MS;
    return { offline, pruned: await pruneSamples(deps.db, new Date(now.getTime() - SAMPLE_RETENTION_MS)) };
  };
}
