import {
  type ApiKey,
  type AuditEntry,
  apiKeys,
  auditChanges,
  isUuid,
  type Machine,
  machines,
  type TenantDb,
  type TenantSet,
  type TenantValues,
} from '@mwc/db';
import { and, asc, eq, isNull } from 'drizzle-orm';

/**
 * The machines table and its runner keys, through the company's tenant only. A removed machine (`removed_at`) is gone
 * for every read here; its rows stay for the history. The other tables have their files in `repo/`.
 */

const present = isNull(machines.removedAt);
const byId = (id: string) => and(eq(machines.id, id), present);

/** The company's machines, by name. */
const list = (t: TenantDb): Promise<Machine[]> =>
  t.select(machines, present).orderBy(asc(machines.name), asc(machines.id));

/** One machine of the company; undefined for an unknown, malformed, removed or another company's id. */
async function get(t: TenantDb, id: string): Promise<Machine | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = await t.select(machines, byId(id));
  return row;
}

async function insert(t: TenantDb, values: TenantValues<typeof machines>): Promise<Machine> {
  const [row] = (await t.insert(machines, values).returning()) as [Machine];
  return row;
}

/** Changes a machine that is not removed; returns it as it is now, or undefined when there is none. */
async function update(
  t: TenantDb,
  id: string,
  set: TenantSet<typeof machines>,
): Promise<Machine | undefined> {
  const [row] = await t.update(machines, set, byId(id)).returning();
  return row;
}

/**
 * A heartbeat: `last_seen_at`, and back online when the sweep had marked it offline while its runner still talked.
 * One write unless it was offline.
 */
async function seen(t: TenantDb, id: string, at: Date): Promise<void> {
  const [row] = await t
    .update(machines, { lastSeenAt: at }, eq(machines.id, id))
    .returning({ status: machines.status });
  if (row?.status === 'offline') await t.update(machines, { status: 'online' }, eq(machines.id, id));
}

/** Marks a machine offline, removed or not (its runner's socket closed). */
async function offline(t: TenantDb, id: string): Promise<void> {
  await t.update(machines, { status: 'offline' }, eq(machines.id, id));
}

async function insertKey(t: TenantDb, values: TenantValues<typeof apiKeys>): Promise<ApiKey> {
  const [row] = (await t.insert(apiKeys, values).returning()) as [ApiKey];
  return row;
}

/** Revokes every runner key of the machine not revoked yet; returns the keys revoked now. */
const revokeRunnerKeys = (t: TenantDb, machineId: string, at: Date): Promise<ApiKey[]> =>
  t
    .update(
      apiKeys,
      { revokedAt: at },
      and(eq(apiKeys.kind, 'runner'), eq(apiKeys.machineId, machineId), isNull(apiKeys.revokedAt)),
    )
    .returning();

export function machinesRepo() {
  return {
    list,
    get,
    insert,
    update,
    seen,
    offline,
    insertKey,
    revokeRunnerKeys,
    audit: (t: TenantDb, entry: AuditEntry) => auditChanges(t, entry),
  };
}

export type MachinesRepo = ReturnType<typeof machinesRepo>;
