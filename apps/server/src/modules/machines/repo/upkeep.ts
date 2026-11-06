import { companies, type DbHandle, type Machine, machineSamples, machines } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { and, asc, eq, getTableColumns, isNull, lt, ne, or } from 'drizzle-orm';

/**
 * The machines' upkeep across every company (the jobs loop): the one place this module reads without a tenant, listed
 * in biome.json's exemption, since a lapsed lease, an old sample or a power decision can be any company's. It only finds and deletes;
 * changes to a machine go through its company's tenant (`service/upkeep.ts`).
 */

/** The machines still marked online whose runner has said nothing since before `cutoff`, in companies not deleted. */
export const staleMachines = (db: DbHandle, cutoff: Date): Promise<{ companyId: string; id: string }[]> =>
  rawDb(db)
    .select({ companyId: machines.companyId, id: machines.id })
    .from(machines)
    .innerJoin(companies, eq(companies.id, machines.companyId))
    .where(
      and(
        eq(machines.status, 'online'),
        or(isNull(machines.lastSeenAt), lt(machines.lastSeenAt, cutoff)),
        ne(companies.status, 'deleted'),
        isNull(companies.deletedAt),
      ),
    );

/** Every machine not removed, in companies not deleted, by company: the power scheduler decides each one. */
export const presentMachines = (db: DbHandle): Promise<Machine[]> =>
  rawDb(db)
    .select(getTableColumns(machines))
    .from(machines)
    .innerJoin(companies, eq(companies.id, machines.companyId))
    .where(and(isNull(machines.removedAt), ne(companies.status, 'deleted'), isNull(companies.deletedAt)))
    .orderBy(asc(machines.companyId), asc(machines.id));

/** Deletes every sample taken before `before`; returns how many. */
export async function pruneSamples(db: DbHandle, before: Date): Promise<number> {
  const rows = await rawDb(db)
    .delete(machineSamples)
    .where(lt(machineSamples.at, before))
    .returning({ at: machineSamples.at });
  return rows.length;
}
