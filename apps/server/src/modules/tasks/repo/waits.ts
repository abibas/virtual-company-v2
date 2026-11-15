import { type TenantDb, tasks, taskWaits } from '@mwc/db';
import type { TaskState } from '@mwc/shared/enums';
import { asc, eq, inArray, sql } from 'drizzle-orm';

/** "Waits for" (T-39): which tasks a task waits for, through the company's tenant only. */

/** A task a task waits for, as views name it. */
export interface WaitRow {
  readonly taskId: string;
  readonly waitsForTaskId: string;
  readonly number: number;
  readonly title: string;
  readonly state: TaskState;
}

/** The tasks these tasks wait for, each with its number, title and state, by the waiting task's id. */
async function of(t: TenantDb, taskIds: readonly string[]): Promise<Map<string, WaitRow[]>> {
  const byTask = new Map<string, WaitRow[]>();
  if (taskIds.length === 0) return byTask;
  const edges = await t.select(taskWaits, inArray(taskWaits.taskId, [...taskIds]));
  if (edges.length === 0) return byTask;
  const waited = await t
    .selectFields(
      tasks,
      { id: tasks.id, number: tasks.number, title: tasks.title, state: tasks.state },
      inArray(tasks.id, [...new Set(edges.map((edge) => edge.waitsForTaskId))]),
    )
    .orderBy(asc(tasks.number));
  for (const task of waited)
    for (const edge of edges.filter((e) => e.waitsForTaskId === task.id)) {
      const row = {
        taskId: edge.taskId,
        waitsForTaskId: task.id,
        number: task.number,
        title: task.title,
        state: task.state,
      };
      byTask.set(edge.taskId, [...(byTask.get(edge.taskId) ?? []), row]);
    }
  return byTask;
}

/** Every "waits for" between the flow's tasks: the edges a cycle check walks. */
const ofFlow = (t: TenantDb, flowId: string) =>
  t.selectFields(
    taskWaits,
    { taskId: taskWaits.taskId, waitsForTaskId: taskWaits.waitsForTaskId },
    sql`${taskWaits.taskId} in (select ${tasks.id} from ${tasks} where ${tasks.companyId} = ${taskWaits.companyId} and ${tasks.flowId} = ${flowId})`,
  );

/** Replaces what the task waits for. */
async function set(t: TenantDb, taskId: string, waitsForTaskIds: readonly string[]): Promise<void> {
  await t.delete(taskWaits, eq(taskWaits.taskId, taskId));
  if (waitsForTaskIds.length > 0)
    await t.insert(
      taskWaits,
      waitsForTaskIds.map((waitsForTaskId) => ({ taskId, waitsForTaskId })),
    );
}

export const waitRows = { of, ofFlow, set };
