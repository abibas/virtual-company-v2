import type { Chat, TenantDb } from '@mwc/db';
import { taskKey } from '@mwc/shared/flows';
import { taskChatsRepo } from '../repo/task-chats.ts';
import { roundSpanOf, type StepConversation } from '../rules/task-chats.ts';
import type { ChatTaskView } from '../schemas/task.ts';

/**
 * What names a task's conversation in an agent's chats (2026-11-14, T-19; docs/harness.md "Task conversations in the
 * agent's chats"): its task's key, title and state, its step's name and the rounds it covers, read now for many
 * conversations at once (three reads whatever their number, none without a task's conversation among them).
 */

/** The step's name, kept when the step is gone. */
const REMOVED_STEP = 'a removed step';

/** A task's conversation: a chat that names its task, step and round (all or none, the table's CHECK). */
type TaskChat = Pick<Chat, 'id'> & { taskId: string; taskStepId: string; taskRound: number };

type Named = Pick<Chat, 'id' | 'taskId' | 'taskStepId' | 'taskRound'>;

const isTaskChat = (chat: Named): chat is TaskChat => chat.taskId !== null;

/** The name of each task's conversation among `chats`, by chat id; other chats have none. */
export async function taskNamesOf(t: TenantDb, chats: readonly Named[]): Promise<Map<string, ChatTaskView>> {
  const own = chats.filter(isTaskChat);
  const out = new Map<string, ChatTaskView>();
  if (own.length === 0) return out;
  const taskIds = [...new Set(own.map((chat) => chat.taskId))];
  const tasks = new Map((await taskChatsRepo.tasksOf(t, taskIds)).map((task) => [task.id, task]));
  const stepIds = [...new Set(own.map((chat) => chat.taskStepId))];
  const steps = new Map((await taskChatsRepo.stepNames(t, stepIds)).map((step) => [step.id, step.name]));
  const all = await taskChatsRepo.conversationsOf(t, taskIds);
  for (const chat of own) {
    // The chat's foreign key keeps its task.
    const task = tasks.get(chat.taskId) as NonNullable<ReturnType<typeof tasks.get>>;
    const siblings = all.filter((other) => other.taskId === chat.taskId) as StepConversation[];
    const entries = task.rounds[chat.taskStepId]?.entries ?? chat.taskRound;
    out.set(chat.id, {
      taskId: task.id,
      key: taskKey(task.number),
      title: task.title,
      step: steps.get(chat.taskStepId) ?? REMOVED_STEP,
      rounds: roundSpanOf({ id: chat.id, stepId: chat.taskStepId, round: chat.taskRound }, siblings, entries),
      state: task.state,
      atStep: task.state === 'active' && task.currentStepId === chat.taskStepId,
    });
  }
  return out;
}
