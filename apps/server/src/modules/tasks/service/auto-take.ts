import { type DbHandle, type Flow, type TenantDb, tenant } from '@mwc/db';
import { newId } from '@mwc/shared/ids';
import type { Logger } from 'pino';
import type { Timers } from '../../../platform/jobs/runner.ts';
import { autoTakeFlows } from '../repo/auto-take-due.ts';
import { type TasksRepo, tasksRepo } from '../repo.ts';
import { move, type Transition } from '../rules/machine.ts';
import { inOrder } from '../rules.ts';
import { applyMove } from './apply.ts';
import type { Caller } from './audit.ts';
import { type RunDeps, runStep, startedNow } from './runs.ts';
import { rosterOf } from './team.ts';

/**
 * Auto-take from Queued (T-25): while a flow's `auto_take` is on and fewer of its tasks than its `in_progress_limit` are
 * in progress (active at any step; escalated, queued, done and cancelled ones do not count), its next queued task (by
 * priority, urgent first, then its place in Queued, T-39; one waiting for a task not done or cancelled is skipped)
 * enters its first step as if the Lead had routed it, under the flow's lock,
 * and starts there when that step starts by itself. Its history says it was taken from Queued by itself. It runs after
 * a move that ends a task's time in progress, when a task is created in Queued, when the setting is turned on or its
 * limit changes, and once at the server's start.
 */

/** True when a move ended a task's time in progress: done, cancelled or escalated. */
export const endsProgress = (transition: Pick<Transition, 'outcome'>): boolean =>
  transition.outcome === 'done' || transition.outcome === 'cancelled' || transition.outcome === 'escalated';

/** Most Wanted itself as the take's caller: its rows have no actor; the runs it starts are for the flow's Lead. */
const takeCaller = (flow: Flow): Caller => ({
  principalId: flow.leadPrincipalId,
  role: 'owner',
  requestId: newId(),
  system: true,
});

/** The Lead's route, marked as the take's: by itself, from Queued. */
const marked = (transition: Transition): Transition => ({
  ...transition,
  events: transition.events.map((event) =>
    event.kind === 'routed' ? { ...event, system: true, details: { autoTake: true } } : event,
  ),
});

/** Takes the flow's next queued tasks while it has room (see above); returns how many it took. */
export async function takeQueued(
  deps: RunDeps,
  repo: TasksRepo,
  t: TenantDb,
  flowId: string,
  now: Date,
): Promise<number> {
  const taken = await t.transaction(async (tx) => {
    const flow = await repo.flows.lock(tx, flowId);
    if (flow === undefined || !flow.autoTake) return undefined;
    const steps = inOrder(await repo.flows.steps(tx, flow.id));
    const first = steps[0];
    const room = flow.inProgressLimit - (await repo.tasks.activeCount(tx, flow.id));
    if (first === undefined || room <= 0) return undefined;
    const queued = await repo.tasks.nextQueued(tx, flow.id, room);
    if (queued.length === 0) return undefined;
    const roster = await rosterOf(tx);
    const caller = takeCaller(flow);
    const starts: string[] = [];
    for (const row of queued) {
      const task = await repo.tasks.lock(tx, row.id);
      const routed = move(task, steps, { action: 'route', toStepId: first.id }, roster.isPerson);
      if (!routed.ok) continue;
      const transition = marked(routed);
      const moved = { task, flow, from: undefined, roster, transition, action: 'route', now };
      await applyMove(repo, tx, caller, moved);
      if (startedNow(transition)) starts.push(task.id);
    }
    return { caller, starts, count: queued.length };
  });
  if (taken === undefined) return 0;
  for (const id of taken.starts) await runStep(deps, repo, t, taken.caller, id);
  return taken.count;
}

/** How long after the server's start its one take waits, so the runners are back before a step starts. */
export const AUTO_TAKE_START_DELAY_MS = 30_000;

/**
 * Once, a while after the server's start (`AUTO_TAKE_START_DELAY_MS`): each flow with auto-take on takes what it
 * missed while the server was down. A flow that fails is logged and the others go on.
 */
export function autoTakeAtStart(
  deps: RunDeps & { readonly db: DbHandle; readonly clock: () => Date; readonly logger: Logger },
  timers: Timers,
): void {
  timers.setTimeout(async () => {
    try {
      for (const flow of await autoTakeFlows(deps.db)) {
        const t = await tenant(deps.db, flow.companyId);
        await takeQueued(deps, tasksRepo, t, flow.flowId, deps.clock()).catch((error: unknown) =>
          deps.logger.error({ err: error, flowId: flow.flowId }, 'tasks: an auto-take at start failed'),
        );
      }
    } catch (error) {
      deps.logger.error({ err: error }, 'tasks: the auto-take at start failed');
    }
  }, AUTO_TAKE_START_DELAY_MS);
}
