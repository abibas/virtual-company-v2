import type { DbHandle, Flow, LeadWakeEvent, Task, TenantDb } from '@mwc/db';
import type { LeadWakeOutcome } from '@mwc/shared/enums';
import type { TeamChats } from '../../../chats/index.ts';
import type { LeadNotWokenReason } from '../../../notifications/rules.ts';
import { notify } from '../../../notifications/service.ts';
import type { TasksRepo } from '../../repo.ts';
import {
  capReached,
  DAY_MS,
  HOUR_MS,
  settingsOf,
  stillCurrent,
  tellsPerson,
  windowPassed,
} from '../../rules/wake.ts';
import { type Roster, rosterOf } from '../team.ts';
import { wakeMessage } from './message.ts';
import { leadIsAgent } from './record.ts';

/**
 * Telling a flow's Lead agent its pending events (S6c, docs/processes.md "Built: the Lead wakes up"), once the flow's
 * quiet window after the oldest the tick saw has passed. Events whose task moved on meanwhile (a person handled it) are
 * let go, and so is everything when the Lead is no agent on the chart now. Past the flow's cap for the hour or the day
 * the events are held (`capped`); otherwise they go as one message to the Lead's team chat (the chats module's
 * `TeamChats`), as one turn Most Wanted queues, or held because the Lead cannot run (`unreachable`, the refusal's
 * words kept). Held events tell the Lead's nearest person once (`lead_not_woken`), the first time for that reason
 * since the Lead was last told. Not in a transaction: the chats module starts its turn on its own.
 */

/** What delivery needs: the database (names) and the chats' side; none: nothing is told (the events wait). */
export interface WakeDeps {
  readonly db: DbHandle;
  readonly chats?: TeamChats | undefined;
}

/** How a flow's delivery went: an outcome, still in its window, or nothing to tell. */
export type FlowDelivery = Exclude<LeadWakeOutcome, 'pending'> | 'waiting' | 'none';

const DROPPED = { lead: 'The Lead is no agent on the chart now', moved: 'The task moved on first' } as const;
const CAP_WORDS: Readonly<Record<'hour_cap' | 'day_cap', string>> = {
  hour_cap: "Over the flow's wake-ups for this hour",
  day_cap: "Over the flow's wake-ups for today",
};

/** The pending events' tasks as they are now, by id. */
async function tasksOf(repo: TasksRepo, t: TenantDb, events: readonly LeadWakeEvent[]) {
  const tasks = new Map<string, Task>();
  for (const id of new Set(events.map((event) => event.taskId))) {
    const task = await repo.tasks.get(t, { id });
    if (task) tasks.set(id, task);
  }
  return tasks;
}

const ids = (events: readonly LeadWakeEvent[]) => events.map((event) => event.id);

/** Tells the Lead's nearest person that the Lead was not woken, once per reason (see above). */
async function tellPerson(
  t: TenantDb,
  of: { readonly flow: Flow; readonly roster: Roster; readonly previous: LeadWakeOutcome | undefined },
  outcome: 'capped' | 'unreachable',
  why: { readonly reason: LeadNotWokenReason; readonly detail?: string },
) {
  const person = of.roster.leadPerson(of.flow.leadPrincipalId);
  if (person === null || !tellsPerson(of.previous, outcome)) return;
  const payload = { about: of.flow.leadPrincipalId, ...why };
  await notify(t, null, [{ kind: 'lead_not_woken', recipient: person, payload }]);
}

/** Holds or tells the current events (see above). */
async function tell(
  deps: WakeDeps,
  repo: TasksRepo,
  t: TenantDb,
  of: {
    readonly flow: Flow;
    readonly roster: Roster;
    readonly events: readonly LeadWakeEvent[];
    readonly tasks: ReadonlyMap<string, Task>;
    readonly now: Date;
  },
): Promise<FlowDelivery> {
  const { flow, events, now } = of;
  const since = (ms: number) => repo.wakes.wokeSince(t, flow.id, new Date(now.getTime() - ms));
  const counts = { hour: await since(HOUR_MS), day: await since(DAY_MS) };
  const previous = (await repo.wakes.lastOutcome(t, flow.id))?.outcome;
  const held = { flow, roster: of.roster, previous };
  const cap = capReached(counts, settingsOf(flow));
  if (cap !== undefined) {
    await repo.wakes.finish(t, ids(events), { outcome: 'capped', deliveredAt: now, detail: CAP_WORDS[cap] });
    await tellPerson(t, held, 'capped', { reason: cap });
    return 'capped';
  }
  if (deps.chats === undefined) return 'waiting';
  const prompt = await wakeMessage(deps, repo, t, of);
  const request = { flowId: flow.id, flowName: flow.name, agentPrincipalId: flow.leadPrincipalId, prompt };
  const sent = await deps.chats.wake(t, request);
  if (!sent.ok) {
    await repo.wakes.finish(t, ids(events), {
      outcome: 'unreachable',
      deliveredAt: now,
      detail: sent.message,
    });
    await tellPerson(t, held, 'unreachable', { reason: 'unreachable', detail: sent.message });
    return 'unreachable';
  }
  const told = { outcome: 'woke' as const, deliveredAt: now, chatId: sent.chatId, turnId: sent.turnId };
  await repo.wakes.finish(t, ids(events), told);
  return 'woke';
}

/** Delivers the flow's pending events when its window has passed (see above). */
export async function deliverFlow(
  deps: WakeDeps,
  repo: TasksRepo,
  t: TenantDb,
  flowId: string,
  now: Date,
): Promise<FlowDelivery> {
  const flow = await repo.flows.get(t, flowId);
  const pending = flow === undefined ? [] : await repo.wakes.pendingOf(t, flowId);
  if (flow === undefined || pending.length === 0) return 'none';
  const seen = pending.flatMap((event) => (event.seenAt === null ? [] : [event.seenAt.getTime()]));
  if (seen.length === 0 || !windowPassed(new Date(Math.min(...seen)), flow.wakeWindowSeconds, now))
    return 'waiting';
  const roster = await rosterOf(t);
  if (!leadIsAgent(roster, flow)) {
    await repo.wakes.finish(t, ids(pending), { outcome: 'dropped', deliveredAt: now, detail: DROPPED.lead });
    return 'dropped';
  }
  const tasks = await tasksOf(repo, t, pending);
  const isCurrent = (event: LeadWakeEvent) => {
    const task = tasks.get(event.taskId);
    return task !== undefined && stillCurrent(event.kind, task);
  };
  const stale = pending.filter((event) => !isCurrent(event));
  await repo.wakes.finish(t, ids(stale), { outcome: 'dropped', deliveredAt: now, detail: DROPPED.moved });
  const current = pending.filter(isCurrent);
  if (current.length === 0) return 'dropped';
  return tell(deps, repo, t, { flow, roster, events: current, tasks, now });
}
