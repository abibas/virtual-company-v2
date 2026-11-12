import type { ChatTurn, TenantDb } from '@mwc/db';
import type { TurnToolCall, TurnToolReply } from '../../machines/index.ts';
import type { AgentToolTurn, TaskTurnContext, TaskTurnHook } from './task-hook.ts';

/**
 * An agent's tool call during a live turn (S6a, `live.ts`): answered by the tasks module's hook on the turn's write
 * queue, so a decision is written before the turn's end; none without a hook or an agent.
 */

export const NO_TOOLS_HERE = 'This turn has no tools from the server.';

/** What the turn's sink knows of whose tools it answers: its task step, and the chat's agent. */
interface ToolContext {
  readonly task?: TaskTurnContext | undefined;
  readonly agentPrincipalId?: string | undefined;
}

export async function toolCall(
  tasks: TaskTurnHook | undefined,
  run: (work: () => Promise<void>) => Promise<void>,
  t: TenantDb,
  of: { readonly turn: ChatTurn; readonly context: ToolContext },
  call: TurnToolCall,
): Promise<TurnToolReply> {
  const { turn, context } = of;
  const agentPrincipalId = context.agentPrincipalId ?? context.task?.agentPrincipalId;
  if (tasks?.tool === undefined || agentPrincipalId === undefined) return { ok: false, text: NO_TOOLS_HERE };
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
