import type { ChatTurn, TenantDb } from '@mwc/db';
import type { TurnToolCall, TurnToolReply } from '../../machines/index.ts';
import type { ServerToolsHook } from './server-tools.ts';
import type { AgentToolTurn, TaskTurnContext, TaskTurnHook } from './task-hook.ts';

/**
 * An agent's tool call during a live turn (S6a, `live.ts`): answered by the tasks module's hook on the turn's write
 * queue, so a decision is written before the turn's end; none without a hook or an agent. A call of one of the server's
 * own tools (S7.1c) goes to their hook instead, off the write queue (it waits on Atlassian, which the turn's events must
 * not), with the profile the turn runs on.
 */

export const NO_TOOLS_HERE = 'This turn has no tools from the server.';

/** What the turn's sink knows of whose tools it answers: its task step, and the chat's agent. */
interface ToolContext {
  readonly task?: TaskTurnContext | undefined;
  readonly agentPrincipalId?: string | undefined;
}

/** Who answers a turn's calls: the tasks module's hook (S6a) and the server's own tools' (S7.1c). */
export interface ToolHooks {
  readonly tasks?: TaskTurnHook | undefined;
  readonly serverTools?: ServerToolsHook | undefined;
}

export async function toolCall(
  hooks: ToolHooks,
  run: (work: () => Promise<void>) => Promise<void>,
  t: TenantDb,
  of: { readonly turn: ChatTurn; readonly context: ToolContext },
  call: TurnToolCall,
): Promise<TurnToolReply> {
  const { tasks, serverTools } = hooks;
  const { turn, context } = of;
  const agentPrincipalId = context.agentPrincipalId ?? context.task?.agentPrincipalId;
  if (agentPrincipalId === undefined) return { ok: false, text: NO_TOOLS_HERE };
  if (serverTools?.owns(call.tool)) {
    const { id: turnId, chatId, profileId, createdBy: by } = turn;
    return serverTools.tool(t, { turnId, chatId, agentPrincipalId, profileId, by }, call);
  }
  if (tasks?.tool === undefined) return { ok: false, text: NO_TOOLS_HERE };
  const at: AgentToolTurn = {
    turnId: turn.id,
    chatId: turn.chatId,
    agentPrincipalId,
    by: turn.createdBy,
    task: context.task,
  };
  let reply: TurnToolReply = { ok: false, text: NO_TOOLS_HERE };
  const answer = tasks.tool.bind(tasks);
  await run(async () => {
    reply = await answer(t, at, call);
  });
  return reply;
}
