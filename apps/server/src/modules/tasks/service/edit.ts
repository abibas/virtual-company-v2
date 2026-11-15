import type { Flow, Task, TenantDb } from '@mwc/db';
import { taskKey } from '@mwc/shared/flows';
import type { TasksRepo } from '../repo.ts';
import { editRefusal, intoStepRefusal } from '../rules/access.ts';
import { type Refusal, refuse, TASK_NOT_FOUND, type TaskRef } from '../rules.ts';
import type { EditTask } from '../schemas/tasks.ts';
import { eventRow } from './apply.ts';
import { audit, type Caller } from './audit.ts';
import { takeQueued } from './auto-take.ts';
import { flowTasks, placedPriority, placeInQueue, placeTarget, setWaits, waitsRefusal } from './queue.ts';
import type { RunDeps } from './runs.ts';
import { rosterOf } from './team.ts';
import { shownTask, type TaskResult } from './tasks.ts';

type Edited = Partial<Pick<Task, 'title' | 'description' | 'priority' | 'autoTake'>>;

const NOT_QUEUED = refuse(
  409,
  'not_queued',
  'Only a queued task changes its place in the queue or what it waits for',
);

/** What of the edit differs from the task now (Autotake only while it is queued). */
function changes(task: Task, edit: { readonly [K in keyof Edited]?: Edited[K] | undefined }): Edited {
  const kept = task.state === 'queued' ? edit : { ...edit, autoTake: undefined };
  return Object.fromEntries(
    Object.entries(kept).filter(([field, value]) => value !== undefined && task[field as keyof Task] !== value),
  ) as Edited;
}

/**
 * The checks of an edit's queue part (T-39), before anything is written: a queued task only (409 `not_queued`); its
 * place by those who route (403 `not_lead`), among the flow's queued tasks (422); what it waits for, tasks of its flow
 * without a cycle (422).
 */
async function queuePart(repo: TasksRepo, tx: TenantDb, caller: Caller, flow: Flow, task: Task, edit: EditTask) {
  const { waitsFor, before, after } = edit;
  if (waitsFor === undefined && before === undefined && after === undefined)
    return { ok: true as const, place: undefined, waits: undefined };
  if (task.state !== 'queued') return NOT_QUEUED;
  if (before !== undefined || after !== undefined) {
    const denied = intoStepRefusal(caller, (await rosterOf(tx)).team(flow.leadPrincipalId));
    if (denied) return denied;
  }
  const place = await placeTarget(repo, tx, flow, task, { before, after });
  if (place !== undefined && !place.ok) return place;
  if (waitsFor === undefined) return { ok: true as const, place, waits: undefined };
  const found = await flowTasks(repo, tx, flow, waitsFor);
  if (!found.ok) return found;
  const cycle = await waitsRefusal(repo, tx, flow.id, task.id, found.tasks);
  if (cycle) return cycle;
  return { ok: true as const, place, waits: found.tasks };
}

/**
 * Edits a task's title, description, priority or Autotake (its creator, its team's Lead people, admins, its Lead agent:
 * 403 `not_yours`), and a queued task's place in the queue and what it waits for (T-39, `queuePart`). Only what differs
 * is written, with an `edited` history row naming the fields and their audit rows. Autotake changes only while the task
 * is queued; a queued Autotake task that changed is taken at once when the flow auto-takes and has room (T-34): turned
 * on, or no longer waiting.
 */
export async function editTask(
  deps: RunDeps,
  repo: TasksRepo,
  t: TenantDb,
  caller: Caller,
  change: { readonly ref: TaskRef | undefined; readonly edit: EditTask; readonly now: Date },
): Promise<TaskResult<403 | 404 | 409 | 422>> {
  const found = change.ref === undefined ? undefined : await repo.tasks.get(t, change.ref);
  if (found === undefined) return TASK_NOT_FOUND;
  const done = await t.transaction(async (tx): Promise<{ ok: true; task: Task } | Refusal<403 | 409 | 422>> => {
    const flow = (await repo.flows.lock(tx, found.flowId)) as Flow;
    const task = await repo.tasks.lock(tx, found.id);
    const denied = editRefusal(caller, (await rosterOf(tx)).team(flow.leadPrincipalId), task.createdBy);
    if (denied) return denied;
    const queue = await queuePart(repo, tx, caller, flow, task, change.edit);
    if (!queue.ok) return queue;
    const { title, description, autoTake } = change.edit;
    const priority = placedPriority(change.edit.priority, queue.place?.target, task.priority);
    const set = changes(task, { title, description, priority, autoTake });
    const fields: string[] = Object.keys(set);
    if (fields.length > 0) await repo.tasks.update(tx, task.id, set);
    if (queue.place && (await placeInQueue(repo, tx, task, queue.place))) fields.push('queue');
    const waits = queue.waits;
    if (waits && (await setWaits(repo, tx, task.id, waits))) fields.push('waitsFor');
    if (fields.length === 0) return { ok: true, task };
    const after = await repo.tasks.lock(tx, task.id);
    const details = waits ? { fields, waitsFor: waits.map((other) => taskKey(other.number)) } : { fields };
    await repo.tasks.insertEvents(tx, [eventRow(task.id, caller, { kind: 'edited', details })]);
    await audit(repo, tx, caller, { entityType: 'task', entityId: task.id, action: 'update', before: task, after });
    return { ok: true, task: after };
  });
  if (!done.ok) return done;
  // An Autotake task in Queued that changed: the flow takes it (or an earlier one) when it auto-takes and has room.
  if (done.task.state === 'queued' && done.task.autoTake)
    await takeQueued(deps, repo, t, done.task.flowId, change.now);
  const now = (await repo.tasks.get(t, { id: done.task.id })) as Task;
  return { ok: true, task: await shownTask(deps, repo, t, caller, now) };
}
