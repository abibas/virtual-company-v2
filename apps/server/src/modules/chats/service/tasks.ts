import type { Agent, Chat, TenantDb } from '@mwc/db';
import { agentPlacement } from '../../machines/index.ts';
import { taskChatsRepo } from '../repo/task-chats.ts';
import { turnsRepo } from '../repo/turns.ts';
import { chatsRepo } from '../repo.ts';
import {
  AGENT_ARCHIVED,
  CONTAINER_RUNS_LATER,
  MACHINE_OFFLINE,
  PLACEMENT_MISSING,
  type Refusal,
  refuse,
} from '../rules.ts';
import { auditChat } from './audit.ts';
import { startTurn, type TurnsDeps } from './turns.ts';

/**
 * A task's conversations (S5.3b, docs/harness.md "Task turns"): a step's work is a chat of the step's agent that names
 * the task, the step and the round it began in, so it streams, stops, queues, resumes and opens in Claude Code like any
 * chat, and stays out of the agent's own chat list. The tasks module starts a step's turn through `taskTurns` (Keep
 * continues the step's latest conversation, Fresh begins one per round; different steps never share one) and hears of
 * every message turn of such a chat through the `TaskTurnHook` it passes in (`task-hook.ts`). A step whose agent's
 * machine is stopped starts it when its policy starts it for work, and its turn waits for it (`machine-wait.ts`).
 */

/** A step's turn to start: who moved the task, the step's agent, the conversation's rule, its title and its prompts. */
export interface TaskTurnRequest {
  readonly by: string;
  readonly requestId: string;
  readonly agentPrincipalId: string;
  readonly taskId: string;
  readonly stepId: string;
  readonly round: number;
  /** Keep: continue the step's latest conversation; Fresh: one per round. */
  readonly keep: boolean;
  /** A new conversation's title. */
  readonly title: string;
  /** Why the agent's machine is started when it is stopped, for its power log ("Started for T-3 · Code review"). */
  readonly wakeReason: string;
  /**
   * The full prompt for a new conversation and the delta for one that continues, written for a runner without the
   * agents' tools (`plain`) and for one that offers them (`tools`, S6a), which the agent's runner decides.
   */
  readonly prompt: { readonly plain: StepPrompts; readonly tools: StepPrompts };
}

/** A step's two prompts: for a new conversation, and for one that continues. */
export interface StepPrompts {
  readonly full: string;
  readonly delta: string;
}

export type TaskTurnStarted =
  | { readonly ok: true; readonly chatId: string; readonly turnId: string; readonly continued: boolean }
  | Refusal;

const NOT_AN_AGENT = refuse(409, 'not_an_agent', "The step's assignee is not an agent of this company");

/** Whether the step's latest conversation goes on: same agent, harness and machine, and Keep or the same round. */
const goesOn = (
  chat: Chat | undefined,
  agent: Agent,
  machineId: string,
  request: TaskTurnRequest,
): chat is Chat =>
  chat !== undefined &&
  chat.archivedAt === null &&
  chat.harness === agent.harness &&
  chat.machineId === machineId &&
  (request.keep || chat.taskRound === request.round);

/** The tasks module's way to run a step: start its turn, find one running, stop one. */
export function taskTurns(deps: TurnsDeps) {
  return {
    /**
     * Starts the step's turn as `by`: in the step's latest conversation when it goes on (`goesOn`; the delta prompt once
     * it has a session), else in a new one; refused as any turn is, and when the assignee is no agent, is archived, or
     * has no placement on a machine.
     */
    async start(t: TenantDb, request: TaskTurnRequest): Promise<TaskTurnStarted> {
      const agent = await taskChatsRepo.agentByPrincipal(t, request.agentPrincipalId);
      if (agent === undefined) return NOT_AN_AGENT;
      if (agent.status === 'archived') return AGENT_ARCHIVED;
      const placed = await agentPlacement(t, agent.id);
      const placement = placed.ok ? placed.placement : null;
      if (placement === null) return PLACEMENT_MISSING;
      if (placement.mode === 'container') return CONTAINER_RUNS_LATER;
      const latest = await taskChatsRepo.latestOf(t, request.taskId, request.stepId, agent.id);
      const continued = goesOn(latest, agent, placement.machineId, request);
      const chat = continued ? latest : await newConversation(t, request, agent, placement.machineId);
      const offers = deps.hub.connected(placement.machineId)?.caps.agentTools === true;
      const written = offers ? request.prompt.tools : request.prompt.plain;
      const prompt = continued && chat.sessionId !== null ? written.delta : written.full;
      const wake = { trigger: 'work' as const, reason: request.wakeReason };
      const started = await startTurn(deps, t, { principalId: request.by, wake }, chat.id, prompt);
      if (!started.ok) return started;
      if (started.turn.status === 'failed') return MACHINE_OFFLINE;
      return { ok: true, chatId: chat.id, turnId: started.turn.id, continued };
    },
    /** The turn of the task's conversations at the step that runs or waits for its machine, if any. */
    running: (t: TenantDb, taskId: string, stepId: string) => taskChatsRepo.runningTurnOf(t, taskId, stepId),
    /** True while a running turn waits for its machine's runner to come back with it (S5.4). */
    away: (turnId: string): boolean => deps.live.awayOf(turnId) !== undefined,
    /**
     * Asks the turn's runner to stop it, or ends it while it waits for its machine; false when this process has no such
     * live turn and it does not wait.
     */
    async stop(t: TenantDb, turnId: string): Promise<boolean> {
      if (deps.live.stop(turnId)) return true;
      const turn = await turnsRepo.byId(t, turnId);
      if (turn?.status !== 'queued' || turn.machineWaitAt === null) return false;
      return (await deps.waits?.stop(t, turn)) !== undefined;
    },
  };
}

export type TaskTurns = ReturnType<typeof taskTurns>;

/** A new conversation of the task at the step, with the agent on its machine; audited as any chat's start. */
async function newConversation(
  t: TenantDb,
  request: TaskTurnRequest,
  agent: Agent,
  machineId: string,
): Promise<Chat> {
  const chat = await chatsRepo.insert(t, {
    agentId: agent.id,
    harness: agent.harness,
    machineId,
    profileId: null,
    profileSetBy: null,
    title: request.title,
    taskId: request.taskId,
    taskStepId: request.stepId,
    taskRound: request.round,
    createdBy: request.by,
  });
  await auditChat(t, { principalId: request.by, requestId: request.requestId }, chat, 'create', null);
  return chat;
}
