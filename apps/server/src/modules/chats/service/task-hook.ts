import type { Agent, Chat, ChatTurn, TenantDb } from '@mwc/db';
import { STANDING_INSTRUCTIONS_MAX } from '@mwc/shared/agent-briefing';
import type { ChatTurnKind, ChatTurnStatus } from '@mwc/shared/enums';
import type { CollectedArtifact, TurnCollected, TurnToolCall, TurnToolReply } from '../../machines/index.ts';

/**
 * The port a task's conversation reports to (S5.3b, docs/harness.md "Task turns"): the tasks module implements it and
 * `app.ts` passes it in, so the chats module hears nothing of tasks but this. Every message turn of a chat that names a
 * task asks it where its outputs go before it starts (`taskDraft`, the spec's `artifacts`), and tells it of its start,
 * each file the runner collected, what it left out, and its end. Since S6a it also gives an agent's turns their tools
 * (a task step's, a flow Lead's in its own chats; `toolsFor`) and answers their calls (`tool`).
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
 * A turn Most Wanted queued that ended (a Lead's wake-up or check-in, a team room's turn, a step's own prompt), for the
 * team room (docs/processes.md "The team room"): its chat, the room's message it answered, and how it ended.
 */
export interface SystemTurnEnd extends TaskTurnEnd {
  readonly chatId: string;
  readonly turnId: string;
  readonly roomMessageId: string | null;
}

/** An agent's turn as its tools see it (S6a): the turn, its chat, the chat's agent, who sent its prompt, its task step. */
export interface AgentToolTurn {
  readonly turnId: string;
  readonly chatId: string;
  readonly agentPrincipalId: string;
  /** Who sent the turn's prompt. */
  readonly by: string;
  /** A message turn of a task's conversation; none for the agent's own chats. */
  readonly task?: TaskTurnContext | undefined;
}

/** What a turn gets of the agents' tools (S6a): their names, and a section for its standing instructions. */
export interface AgentToolsPlan {
  readonly tools: readonly string[];
  readonly instructions?: string | undefined;
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
  /**
   * A turn that failed because its runner was away (`error`), which that runner came back with (2026-11-12): the task
   * works at the step again when that failure blocked it and nothing happened to it since; false otherwise (the turn
   * then stays failed and its runner stops it).
   */
  reattached?(
    t: TenantDb,
    turn: TaskTurnContext,
    failure: { readonly error: string | null },
  ): Promise<boolean>;
  /** The agents' tools a turn of this chat gets (S6a): a task step's by its kind, a Lead's in its own chats, or none. */
  toolsFor?(
    t: TenantDb,
    turn: { readonly chatId: string; readonly agentPrincipalId: string; readonly task?: TaskTurnDraft },
  ): Promise<AgentToolsPlan>;
  /** A call of one of them during the turn, checked again and answered (S6a). */
  tool?(t: TenantDb, turn: AgentToolTurn, call: TurnToolCall): Promise<TurnToolReply>;
  /** A message turn Most Wanted queued ended (its row is closed): the team room posts its reply. */
  systemEnded?(t: TenantDb, end: SystemTurnEnd): Promise<void>;
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

/**
 * What a turn's spec adds for the agents' tools (S6a), when its runner offers them (`offers`, `caps.agentTools`): their
 * names, and the standing instructions with the plan's section after them (left out when it would not fit).
 */
export async function toolsOf(
  hook: TaskTurnHook | undefined,
  t: TenantDb,
  turn: {
    readonly chat: Chat;
    readonly agent: Agent;
    readonly kind: ChatTurnKind;
    readonly draft: TaskTurnDraft | undefined;
    readonly offers: boolean;
    readonly instructions: string | undefined;
  },
): Promise<{ readonly tools?: string[]; readonly instructions?: string }> {
  if (!turn.offers || turn.kind !== 'message' || hook?.toolsFor === undefined) return {};
  const plan = await hook.toolsFor(t, {
    chatId: turn.chat.id,
    agentPrincipalId: turn.agent.principalId,
    ...(turn.draft === undefined ? {} : { task: turn.draft }),
  });
  if (plan.tools.length === 0) return {};
  const joined = [turn.instructions, plan.instructions].filter((part) => part !== undefined).join('\n\n');
  const fits = plan.instructions !== undefined && joined.length <= STANDING_INSTRUCTIONS_MAX;
  return { tools: [...plan.tools], ...(fits ? { instructions: joined } : {}) };
}

/** The turn's context once it has its id. */
export const taskContext = (draft: TaskTurnDraft | undefined, turn: Pick<ChatTurn, 'id'>) =>
  draft === undefined ? undefined : { ...draft, turnId: turn.id };
