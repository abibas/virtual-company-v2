import type { Flow, TenantDb } from '@mwc/db';
import type { TasksRepo } from '../../repo.ts';
import { DAY_MS, HOUR_MS, settingsColumns, settingsOf } from '../../rules/wake.ts';
import { FLOW_NOT_FOUND, type Refusal } from '../../rules.ts';
import type { LeadWakeSettingsBody, LeadWakesView } from '../../schemas/wakes.ts';
import { audit, type Caller } from '../audit.ts';
import { lockedForLead } from '../flows.ts';
import { rosterOf } from '../team.ts';
import { leadIsAgent } from './record.ts';

/**
 * A flow's Lead wake-up settings (S6c): read by anyone of the company with how its wake-ups went (the last one told or
 * held, the counts of the last hour and day, what waits), changed by those who lead the team (the Lead's people,
 * admins and owners), audited field by field on the flow.
 */

/** The flow's settings and how its wake-ups went, as of `now`. */
async function viewOf(repo: TasksRepo, t: TenantDb, flow: Flow, now: Date): Promise<LeadWakesView> {
  const roster = await rosterOf(t);
  const since = (ms: number) => repo.wakes.wokeSince(t, flow.id, new Date(now.getTime() - ms));
  const last = await repo.wakes.lastOutcome(t, flow.id);
  return {
    ...settingsOf(flow),
    leadIsAgent: leadIsAgent(roster, flow),
    chat: await repo.wakes.lastChat(t, flow.id),
    last:
      last === undefined
        ? null
        : {
            outcome: last.outcome as 'woke' | 'capped' | 'unreachable',
            at: (last.deliveredAt as Date).toISOString(),
            detail: last.detail,
          },
    counts: {
      hour: await since(HOUR_MS),
      day: await since(DAY_MS),
      pending: (await repo.wakes.pendingOf(t, flow.id)).length,
    },
  };
}

type Answer<S extends 403 | 404 = 403 | 404> =
  | { readonly ok: true; readonly wakes: LeadWakesView }
  | Refusal<S>;

export async function leadWakesOf(
  repo: TasksRepo,
  t: TenantDb,
  flowId: string,
  now: Date,
): Promise<Answer<404>> {
  const flow = await repo.flows.get(t, flowId);
  return flow === undefined ? FLOW_NOT_FOUND : { ok: true, wakes: await viewOf(repo, t, flow, now) };
}

/** Changes the flow's settings (those who lead the team); unchanged settings write nothing. */
export async function putLeadWakes(
  repo: TasksRepo,
  t: TenantDb,
  caller: Caller,
  change: { readonly flowId: string; readonly settings: LeadWakeSettingsBody; readonly now: Date },
): Promise<Answer> {
  const done = await t.transaction(async (tx) => {
    const locked = await lockedForLead(repo, tx, caller, change.flowId);
    if (!locked.ok) return locked;
    const before = locked.flow;
    const set = settingsColumns(change.settings);
    const same = Object.entries(set).every(([key, value]) => before[key as keyof typeof set] === value);
    if (same) return { ok: true as const, flow: before };
    const flow = await repo.flows.update(tx, before.id, set);
    await audit(repo, tx, caller, {
      entityType: 'flow',
      entityId: flow.id,
      action: 'update',
      before,
      after: flow,
    });
    return { ok: true as const, flow };
  });
  return done.ok ? { ok: true, wakes: await viewOf(repo, t, done.flow, change.now) } : done;
}
