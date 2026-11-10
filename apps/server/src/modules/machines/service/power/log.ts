import type { DbHandle, TenantDb } from '@mwc/db';
import { profilesOf } from '../../../identity/service.ts';
import { powerRepo } from '../../repo/power.ts';
import { machinesRepo } from '../../repo.ts';
import { MACHINE_NOT_FOUND, type Refusal } from '../../rules.ts';
import type { PowerEventView } from '../../schemas/power.ts';

/** A machine's power log as the API shows it (docs/machines.md, S4.4b): its events, each person named. */

const repo = machinesRepo();

/** The machine's last `limit` power events, newest first, each person named from their profile. */
export async function powerEvents(
  db: DbHandle,
  t: TenantDb,
  machineId: string,
  limit: number,
): Promise<{ readonly ok: true; readonly events: PowerEventView[] } | Refusal<404>> {
  const machine = await repo.get(t, machineId);
  if (machine === undefined) return MACHINE_NOT_FOUND;
  const rows = await powerRepo.events(t, machine.id, limit);
  const userOf = (actor: string) => (actor.startsWith('user:') ? actor.slice('user:'.length) : undefined);
  const userIds = [...new Set(rows.flatMap((row) => userOf(row.actor) ?? []))];
  const people = userIds.length === 0 ? new Map() : await profilesOf(db, userIds);
  const nameOf = (actor: string) => {
    const person = people.get(userOf(actor) ?? '');
    return person === undefined ? null : (person.displayName ?? person.primaryEmail);
  };
  return {
    ok: true,
    events: rows.map((row) => ({
      id: row.id,
      action: row.action,
      reason: row.reason,
      actor: row.actor,
      actorName: nameOf(row.actor),
      at: row.at.toISOString(),
    })),
  };
}
