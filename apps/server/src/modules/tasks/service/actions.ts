import type { Flow, Task, TenantDb } from '@mwc/db';
import type { TasksRepo } from '../repo.ts';
import { actRefusal } from '../rules/access.ts';
import { closedFromOf, move, type Transition } from '../rules/machine.ts';
import { moveRefusal } from '../rules/moves.ts';
import { type Refusal, refuse, TASK_NOT_FOUND, type TaskRef } from '../rules.ts';
import type { TaskActionRequest, TaskDetailView } from '../schemas/tasks.ts';
import { applyMove } from './apply.ts';
import { storeReopenNote } from './artifacts.ts';
import type { Caller } from './audit.ts';
import { endsProgress, takeQueued } from './auto-take.ts';
import { type RunDeps, runStep, startedNow } from './runs.ts';
import { shownTask } from './tasks.ts';
import { rosterOf } from './team.ts';

type Deps = RunDeps;

/** A move away from a step whose turn runs, without `force` (S5.3b). */
export const STEP_RUNNING = refuse(
  409,
  'step_running',
  "The step's turn is running: stop it first, or move the task with force, which stops it",
);

export type MoveResult =
  | { readonly ok: true; readonly outcome: Transition['outcome']; readonly task: TaskDetailView }
  | Refusal;

/**
 * Makes a move on a task (`POST …/tasks/{taskId}/actions`) in one transaction, under its flow's lock and then its own
 * (every move and every change of the flow's steps takes them in that order). Refused, in this order: no such task
 * (404 `task_not_found`); it moved from the step the caller saw (`fromStepId`: 409 `task_moved`); the task as it stands
 * has no such move (409 `wrong_state`, 422 `wrong_kind`, `no_send_back_target`); the caller may not make it (403
 * `not_your_step`, `not_lead`); the move's own (422 `reason_required`, `step_required`, `unknown_step`, 409
 * `already_at_step`). A send-back over its step's limit is not refused: it escalates the task to the Lead. While a turn
 * of its step's conversations runs (S5.3b), a move is refused after the caller's own checks (409 `step_running`) unless
 * it says `force`, which stops that turn once the move is written. A move that starts the task at an agent's step runs
 * the step (`runStep`), after the transaction; one that ends its time in progress lets the flow auto-take (T-25). A
 * reopen (T-28) keeps its reason and findings as the round's hand-off note of the step the task was closed at, so the
 * step it goes back to reads the correction in its prompt.
 */
export async function actOnTask(
  deps: Deps,
  repo: TasksRepo,
  t: TenantDb,
  caller: Caller,
  request: { readonly ref: TaskRef | undefined; readonly body: TaskActionRequest; readonly now: Date },
): Promise<MoveResult> {
  const found = request.ref === undefined ? undefined : await repo.tasks.get(t, request.ref);
  if (found === undefined) return TASK_NOT_FOUND;
  // Read before the transaction (the chats' service is not called inside one): the turn its step runs, if any.
  const at = found.state === 'active' ? found.currentStepId : null;
  const running = at === null ? undefined : await deps.steps?.running(t, found.id, at);
  const done = await t.transaction(
    async (tx): Promise<{ ok: true; transition: Transition; task: Task } | Refusal> => {
      const flow = (await repo.flows.lock(tx, found.flowId)) as Flow;
      const task = await repo.tasks.lock(tx, found.id);
      const { body } = request;
      if (body.fromStepId !== undefined && body.fromStepId !== task.currentStepId) {
        return refuse(409, 'task_moved', 'The task moved since you saw it; look again before you move it');
      }
      const steps = await repo.flows.steps(tx, flow.id);
      const current = steps.find((step) => step.id === task.currentStepId);
      const notNow = moveRefusal(task, current, body.action);
      if (notNow) return notNow;
      const roster = await rosterOf(tx);
      const denied = actRefusal(caller, roster.team(flow.leadPrincipalId), body.action, current);
      if (denied) return denied;
      if (running !== undefined && task.currentStepId === at && body.force !== true) return STEP_RUNNING;
      // A reopen (T-28) leaves from the step the task was closed at.
      const reopening = body.action === 'reopen';
      const closedFrom = reopening ? closedFromOf(await repo.tasks.events(tx, task.id)) : null;
      const transition = move(task, steps, { ...body, closedFrom }, roster.isPerson);
      if (!transition.ok) return transition;
      const from = reopening ? steps.find((step) => step.id === transition.events[0]?.from?.id) : current;
      const moved = { task, flow, from, roster, transition, action: body.action, now: request.now };
      const after = await applyMove(repo, tx, caller, moved);
      if (reopening && from !== undefined) {
        const note = { task, step: from, by: caller.principalId, reason: body.reason, findings: body.findings };
        await storeReopenNote(repo, tx, note);
      }
      return { ok: true, transition, task: after };
    },
  );
  if (!done.ok) return done;
  if (running !== undefined && request.body.force === true) await deps.steps?.stop(t, running);
  if (startedNow(done.transition)) await runStep(deps, repo, t, caller, done.task.id);
  // Its time in progress ended: the flow takes its next queued task when it auto-takes (T-25).
  if (endsProgress(done.transition)) await takeQueued(deps, repo, t, done.task.flowId, request.now);
  const now = (await repo.tasks.get(t, { id: done.task.id })) as Task;
  return { ok: true, outcome: done.transition.outcome, task: await shownTask(deps, repo, t, caller, now) };
}
