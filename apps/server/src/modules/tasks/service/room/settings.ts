import type { TenantDb } from '@mwc/db';
import type { TasksRepo } from '../../repo.ts';
import type { Refusal } from '../../rules.ts';
import { audit, type Caller } from '../audit.ts';
import { lockedForLead } from '../flows.ts';

/**
 * A flow's team room's cap (docs/processes.md "The team room"): the answers its people's messages may ask of its agents
 * in an hour, set on the Flow tab by those who lead the team (the Lead's people, admins and owners), audited on the flow.
 */

/** Changes the room's cap (see above); an unchanged cap writes nothing. */
export async function putRoomCap(
  repo: TasksRepo,
  t: TenantDb,
  caller: Caller,
  change: { readonly flowId: string; readonly maxPerHour: number },
): Promise<{ readonly ok: true } | Refusal<403 | 404>> {
  return t.transaction(async (tx) => {
    const locked = await lockedForLead(repo, tx, caller, change.flowId);
    if (!locked.ok) return locked;
    const before = locked.flow;
    if (before.roomMaxPerHour === change.maxPerHour) return { ok: true as const };
    const after = await repo.flows.update(tx, before.id, { roomMaxPerHour: change.maxPerHour });
    await audit(repo, tx, caller, {
      entityType: 'flow',
      entityId: after.id,
      action: 'update',
      before,
      after,
    });
    return { ok: true as const };
  });
}
