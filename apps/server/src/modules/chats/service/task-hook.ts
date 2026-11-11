import type { Agent, Chat, ChatTurn, TenantDb } from '@mwc/db';
import type { ChatTurnKind, ChatTurnStatus } from '@mwc/shared/enums';
import type { CollectedArtifact, TurnCollected } from '../../machines/index.ts';

/**
 * The port a task's conversation reports to (S5.3b, docs/harness.md "Task turns"): the tasks module implements it and
 * `app.ts` passes it in, so the chats module hears nothing of tasks but this. Every message turn of a chat that names a
 * task asks it where its outputs go before it starts (`taskDraft`, the spec's `artifacts`), and tells it of its start,
 * each file the runner collected, what it left out, and its end.
 */

/** A task's conversation as the hook hears of it: the task, the step, the chat and the step's agent. */
export interface TaskTurnLink {
  readonly taskId: string;
  readonly stepId: string;
  readonly chatId: string;
  readonly agentPrincipalId: string;
}

/** What the task gives a message turn of its conversation: the round it counts in, and where its outputs go. */
export interface TaskTurnPlan {
  readonly round: number;
  /** Relative to the agent's home folder (`TurnSpec.artifacts.dir`). */
  readonly artifactsDir: string;
}

/** A message turn of a task's conversation. */
export interface TaskTurnContext extends TaskTurnLink, TaskTurnPlan {
  readonly turnId: string;
}

/** How a task's turn ended, as the chat recorded it. */
export interface TaskTurnEnd {
  readonly status: ChatTurnStatus;
  readonly resultText: string | null;
  readonly error: string | null;
}

/**
 * The tasks module's side of a task's conversation; its methods never throw (they log their own failures), since they
 * run on a turn's write queue and a request's path.
 */
export interface TaskTurnHook {
  /** Before a message turn starts: its round and outputs folder; undefined when the task gives none (its step is gone). */
  prepare(t: TenantDb, link: TaskTurnLink): Promise<TaskTurnPlan | undefined>;
  /** The turn started (`by`: who sent its prompt). */
  started(t: TenantDb, turn: TaskTurnContext, by: string): Promise<void>;
  /** A file the runner collected from the outputs folder, put together and checked. */
  collected(t: TenantDb, turn: TaskTurnContext, file: CollectedArtifact): Promise<void>;
  /** What the runner collected and left out. */
  skipped(t: TenantDb, turn: TaskTurnContext, collected: TurnCollected): Promise<void>;
  /** The turn ended (its row is closed). */
  ended(t: TenantDb, turn: TaskTurnContext, end: TaskTurnEnd): Promise<void>;
}

/** A task turn before it has an id: what `startTurn` and the queue add to its spec and hand to the live turn. */
export type TaskTurnDraft = Omit<TaskTurnContext, 'turnId'>;

/** A message turn of a task's conversation: the hook's plan for it, with its link; undefined for any other turn. */
export async function taskDraft(
  hook: TaskTurnHook | undefined,
  t: TenantDb,
  turn: { readonly chat: Chat; readonly agent: Agent; readonly kind: ChatTurnKind },
): Promise<TaskTurnDraft | undefined> {
  const { chat, agent, kind } = turn;
  if (hook === undefined || kind !== 'message' || chat.taskId === null || chat.taskStepId === null)
    return undefined;
  const link = {
    taskId: chat.taskId,
    stepId: chat.taskStepId,
    chatId: chat.id,
    agentPrincipalId: agent.principalId,
  };
  const plan = await hook.prepare(t, link);
  return plan && { ...link, ...plan };
}

/** What a turn's spec adds for a task's outputs. */
export const artifactsOf = (draft: TaskTurnDraft | undefined) =>
  draft === undefined ? {} : { artifacts: { dir: draft.artifactsDir } };

/** The turn's context once it has its id. */
export const taskContext = (draft: TaskTurnDraft | undefined, turn: Pick<ChatTurn, 'id'>) =>
  draft === undefined ? undefined : { ...draft, turnId: turn.id };
