import type { Flow, TenantDb } from '@mwc/db';
import { isStuck, type LeadCheckInTask, leadCheckInMessage, taskKey } from '@mwc/shared/flows';
import type { TasksRepo } from '../../repo.ts';
import { type CheckInSkip, checkInDue, checkInSkip, checkInTask } from '../../rules/check-in.ts';
import { capReached, DAY_MS, HOUR_MS, settingsOf } from '../../rules/wake.ts';
import { type Roster, rosterOf } from '../team.ts';
import { CAP_WORDS, tellPerson, type WakeDeps } from './deliver.ts';
import { leadIsAgent } from './record.ts';

/**
 * A flow Lead's check-ins (docs/processes.md "Check-ins"): every N minutes while its flow has active or escalated tasks,
 * the tick looks at the flow and, unless the check-in is skipped, wakes its Lead agent in its team chat with a digest
 * of the open tasks (`leadCheckInMessage`), as one turn Most Wanted queues. It is due N minutes after the later of the
 * Lead's last wake-up and the last time the tick looked at the flow for one (the first time it saw the flow with work
 * starts that clock, in memory: a restart starts it again). A due check-in is skipped while the Lead has a turn running
 * or waiting in any chat, while the flow's events wait for their window (their wake-up comes first), and when nothing
 * changed since the last wake-up and nothing is stuck. It counts toward the flow's caps (held `capped` past one, the
 * nearest person told once), never starts a stopped machine (skipped), and a Lead that cannot run is held `unreachable`
 * as an event's wake-up is. Each check-in told or held is a `check_in` row of no task.
 */

/** When the tick last looked at each flow for a check-in. */
export interface CheckInClock {
  /** When it last looked at the flow; the first time, now (the clock starts). */
  lookedAt(flowId: string, now: Date): Date;
  look(flowId: string, now: Date): void;
  /** Forgets the flows not in this list (they have no work now: their clock starts again with their next task). */
  keepOnly(flowIds: readonly string[]): void;
}

export function checkInClock(): CheckInClock {
  const looked = new Map<string, Date>();
  return {
    lookedAt(flowId, now) {
      const at = looked.get(flowId);
      if (at !== undefined) return at;
      looked.set(flowId, now);
      return now;
    },
    look(flowId, now) {
      looked.set(flowId, now);
    },
    keepOnly(flowIds) {
      const keep = new Set(flowIds);
      for (const id of looked.keys()) if (!keep.has(id)) looked.delete(id);
    },
  };
}

/** How a flow's check-in went: not due yet, skipped (and why), told, held, or nothing to do. */
export type CheckInOutcome =
  | 'not_due'
  | CheckInSkip
  | 'machine_off'
  | 'woke'
  | 'capped'
  | 'unreachable'
  | 'none';

/** A stopped machine is never started for a check-in: these refusals skip it. */
const MACHINE_OFF: ReadonlySet<string> = new Set(['machine_offline', 'machine_stopped']);

/** The flow's active and escalated tasks as the digest tells them, as of `now`. */
async function openBoard(repo: TasksRepo, t: TenantDb, flow: Flow, now: Date): Promise<LeadCheckInTask[]> {
  const open = (await repo.tasks.open(t, flow.id)).filter((task) => task.state !== 'queued');
  const steps = new Map((await repo.flows.steps(t, flow.id)).map((step) => [step.id, step.name]));
  const since = await repo.checkIns.lastEventAt(t, flow.id);
  const turns = await repo.checkIns.turnsOn(t, flow.id, open);
  return open.map((task) =>
    checkInTask(task, {
      key: taskKey(task.number),
      // An active or escalated task is always at a step (escalated: the one it came from).
      step: steps.get(task.currentStepId as string) ?? null,
      since: since.get(task.id),
      turn: turns.get(task.id),
      now,
    }),
  );
}

/** Tells or holds the check-in (see above). */
async function tell(
  deps: WakeDeps,
  repo: TasksRepo,
  t: TenantDb,
  of: { readonly flow: Flow; readonly roster: Roster; readonly board: LeadCheckInTask[]; readonly now: Date },
): Promise<CheckInOutcome> {
  const { flow, now } = of;
  const since = (ms: number) => repo.wakes.wokeSince(t, flow.id, new Date(now.getTime() - ms));
  const cap = capReached({ hour: await since(HOUR_MS), day: await since(DAY_MS) }, settingsOf(flow));
  const previous = (await repo.wakes.lastOutcome(t, flow.id))?.outcome;
  const held = { flow, roster: of.roster, previous };
  const row = { flowId: flow.id, taskId: null, kind: 'check_in' as const, deliveredAt: now };
  if (cap !== undefined) {
    await repo.wakes.insert(t, { ...row, outcome: 'capped', detail: CAP_WORDS[cap] });
    await tellPerson(t, held, 'capped', { reason: cap });
    return 'capped';
  }
  if (deps.chats === undefined) return 'none';
  const prompt = leadCheckInMessage({ flow: flow.name, tasks: of.board });
  const request = { flowId: flow.id, flowName: flow.name, agentPrincipalId: flow.leadPrincipalId, prompt };
  const sent = await deps.chats.wake(t, { ...request, startMachine: false });
  if (!sent.ok && MACHINE_OFF.has(sent.code)) return 'machine_off';
  if (!sent.ok) {
    await repo.wakes.insert(t, { ...row, outcome: 'unreachable', detail: sent.message });
    await tellPerson(t, held, 'unreachable', { reason: 'unreachable', detail: sent.message });
    return 'unreachable';
  }
  await repo.wakes.insert(t, { ...row, outcome: 'woke', chatId: sent.chatId, turnId: sent.turnId });
  return 'woke';
}

/** Looks at the flow for a check-in, and tells it when it is due and not skipped (see above). */
export async function checkInFlow(
  deps: WakeDeps,
  repo: TasksRepo,
  t: TenantDb,
  of: { readonly flowId: string; readonly minutes: number; readonly clock: CheckInClock; readonly now: Date },
): Promise<CheckInOutcome> {
  const { now, clock } = of;
  const lookedAt = clock.lookedAt(of.flowId, now);
  if (!checkInDue({ minutes: of.minutes, lookedAt, lastWoke: undefined, now })) return 'not_due';
  const flow = await repo.flows.get(t, of.flowId);
  if (flow?.wakeCheckInMinutes === null || flow === undefined) return 'none';
  const lastWoke = await repo.wakes.lastWoke(t, flow.id);
  if (!checkInDue({ minutes: flow.wakeCheckInMinutes, lookedAt, lastWoke, now })) return 'not_due';
  clock.look(flow.id, now);
  const roster = await rosterOf(t);
  if (!leadIsAgent(roster, flow)) return 'none';
  const board = await openBoard(repo, t, flow, now);
  const skip = checkInSkip({
    leadBusy: await repo.checkIns.agentBusy(t, flow.leadPrincipalId),
    pending: (await repo.wakes.pendingOf(t, flow.id)).length > 0,
    changed: await repo.checkIns.changedSinceWoke(t, flow.id),
    stuck: board.some(isStuck),
  });
  if (skip !== undefined) return skip;
  return tell(deps, repo, t, { flow, roster, board, now });
}
