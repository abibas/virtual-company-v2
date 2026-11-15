import type { Task, TenantDb } from '@mwc/db';
import type { TaskPriority } from '@mwc/shared/enums';
import { taskKey } from '@mwc/shared/flows';
import type { TasksRepo } from '../repo.ts';
import { type Refusal, refuse, taskRef } from '../rules.ts';

/**
 * The queue's order and "waits for" (T-39): a queued task put right before or after another queued task of its flow
 * (it takes that task's priority unless one is given, so it lands where it was put), and the tasks of its flow it waits
 * for (not itself, never a cycle). Everything here is checked before anything is written, so a refusal changes nothing.
 */

/** A place in the queue: right before or right after another queued task, by its key or id. */
export interface QueuePlace {
  readonly before?: string | undefined;
  readonly after?: string | undefined;
}

const unknownTask = (ref: string, flowName: string) =>
  refuse(422, 'unknown_task', `No task ${ref.toUpperCase()} in the flow "${flowName}"`);

/** The flow's tasks by key or id, in the order given (each once); 422 `unknown_task` for one of another flow or none. */
export async function flowTasks(
  repo: TasksRepo,
  t: TenantDb,
  flow: { readonly id: string; readonly name: string },
  refs: readonly string[],
): Promise<{ ok: true; tasks: Task[] } | Refusal<422>> {
  const found: Task[] = [];
  for (const raw of refs) {
    const ref = taskRef(raw.trim());
    const task = ref === undefined ? undefined : await repo.tasks.get(t, ref);
    if (task === undefined || task.flowId !== flow.id) return unknownTask(raw, flow.name);
    if (!found.some((other) => other.id === task.id)) found.push(task);
  }
  return { ok: true, tasks: found };
}

/**
 * Whether `taskId` may wait for `waitsFor`: not itself (422 `waits_for_itself`), and no task it would wait for waits,
 * through others, for it (422 `wait_cycle`).
 */
export async function waitsRefusal(
  repo: TasksRepo,
  t: TenantDb,
  flowId: string,
  taskId: string,
  waitsFor: readonly Task[],
): Promise<Refusal<422> | undefined> {
  if (waitsFor.some((other) => other.id === taskId))
    return refuse(422, 'waits_for_itself', 'A task cannot wait for itself');
  const edges = (await repo.waits.ofFlow(t, flowId)).filter((edge) => edge.taskId !== taskId);
  const next = new Map<string, string[]>();
  for (const edge of edges) next.set(edge.taskId, [...(next.get(edge.taskId) ?? []), edge.waitsForTaskId]);
  for (const start of waitsFor) {
    const seen = new Set<string>();
    const stack = [start.id];
    while (stack.length > 0) {
      const id = stack.pop() as string;
      if (id === taskId)
        return refuse(
          422,
          'wait_cycle',
          `${taskKey(start.number)} already waits (through the tasks it waits for) for this task: that would be a cycle`,
        );
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(next.get(id) ?? []));
    }
  }
  return undefined;
}

/** The queued task of the flow a place names, and on which side; 422 `unknown_task` or `not_queued` otherwise. */
export async function placeTarget(
  repo: TasksRepo,
  t: TenantDb,
  flow: { readonly id: string; readonly name: string },
  task: Pick<Task, 'id'>,
  place: QueuePlace,
): Promise<{ ok: true; target: Task; side: 'before' | 'after' } | Refusal<422> | undefined> {
  const ref = place.before ?? place.after;
  if (ref === undefined) return undefined;
  const found = await flowTasks(repo, t, flow, [ref]);
  if (!found.ok) return found;
  const target = found.tasks[0] as Task;
  if (target.id === task.id) return refuse(422, 'same_task', 'A task cannot be put before or after itself');
  if (target.state !== 'queued')
    return refuse(
      422,
      'target_not_queued',
      `${taskKey(target.number)} is not queued: place a task among the queued ones`,
    );
  return { ok: true, target, side: place.before !== undefined ? 'before' : 'after' };
}

/**
 * Puts the queued task right before or after the target in its flow's queue and numbers the queue again; true when
 * any place changed.
 */
export async function placeInQueue(
  repo: TasksRepo,
  t: TenantDb,
  task: Task,
  at: { readonly target: Task; readonly side: 'before' | 'after' },
): Promise<boolean> {
  const others = (await repo.tasks.queued(t, task.flowId)).filter((row) => row.id !== task.id);
  const index = others.findIndex((row) => row.id === at.target.id);
  const into = index < 0 ? others.length : at.side === 'before' ? index : index + 1;
  return (await repo.tasks.setQueue(t, [...others.slice(0, into), task, ...others.slice(into)], task.id)) > 0;
}

/** Sets what the task waits for; true when that changed. */
export async function setWaits(repo: TasksRepo, t: TenantDb, taskId: string, waitsFor: readonly Task[]) {
  const now = (await repo.waits.of(t, [taskId])).get(taskId) ?? [];
  const same =
    now.length === waitsFor.length &&
    waitsFor.every((task) => now.some((row) => row.waitsForTaskId === task.id));
  if (same) return false;
  await repo.waits.set(
    t,
    taskId,
    waitsFor.map((task) => task.id),
  );
  return true;
}

/** The priority a placed task takes: the one given, else its target's (so it lands where it was put). */
export const placedPriority = (
  given: TaskPriority | undefined,
  target: Task | undefined,
  own: TaskPriority,
) => given ?? target?.priority ?? own;
