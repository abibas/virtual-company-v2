import {
  type MachinePowerEvent,
  type MachinePowerRow,
  machinePower,
  machinePowerEvents,
  type TenantDb,
} from '@mwc/db';
import type { PowerEventAction } from '@mwc/shared/enums';
import { desc, eq, sql } from 'drizzle-orm';

/**
 * A machine's power policy and the scheduler's state (`machine_power`, one row per machine, made on its first write)
 * and its power log (`machine_power_events`), through the company's tenant only.
 */

const key = [machinePower.companyId, machinePower.machineId];

/** The machine's row; undefined until something is written for it (its policy is then the default). */
async function get(t: TenantDb, machineId: string): Promise<MachinePowerRow | undefined> {
  const [row] = await t.select(machinePower, eq(machinePower.machineId, machineId));
  return row;
}

/** Merges `patch` into the machine's state (top-level keys replaced), making the row when there is none. */
async function mergeState(t: TenantDb, machineId: string, patch: Record<string, unknown>): Promise<void> {
  await t.insert(machinePower, { machineId, state: patch }).onConflictDoUpdate({
    target: key,
    set: { state: sql`${machinePower.state} || excluded.state`, updatedAt: sql`now()` },
  });
}

/** Replaces the machine's policy, saying who changed it, making the row when there is none. */
async function setPolicy(
  t: TenantDb,
  machineId: string,
  policy: Record<string, unknown>,
  updatedBy: string,
): Promise<void> {
  await t.insert(machinePower, { machineId, policy, updatedBy }).onConflictDoUpdate({
    target: key,
    set: { policy: sql`excluded.policy`, updatedBy: sql`excluded.updated_by`, updatedAt: sql`now()` },
  });
}

async function log(
  t: TenantDb,
  values: { machineId: string; action: PowerEventAction; reason: string; actor: string; at: Date },
): Promise<void> {
  await t.insert(machinePowerEvents, values);
}

/** The machine's last `limit` events, newest first. */
const events = (t: TenantDb, machineId: string, limit: number): Promise<MachinePowerEvent[]> =>
  t
    .select(machinePowerEvents, eq(machinePowerEvents.machineId, machineId))
    .orderBy(desc(machinePowerEvents.at), desc(machinePowerEvents.id))
    .limit(limit);

export const powerRepo = { get, mergeState, setPolicy, log, events };
