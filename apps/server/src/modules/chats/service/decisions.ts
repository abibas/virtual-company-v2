import type { Chat, ChatTurn, TenantDb } from '@mwc/db';
import { STANDING_INSTRUCTIONS_MAX } from '@mwc/shared/agent-briefing';
import type { ChatTurnKind } from '@mwc/shared/enums';
import { DECISION_LINE, DECISION_TOOL, type DecisionView } from '@mwc/shared/flows';
import type { TurnToolCall, TurnToolReply } from '../../machines/index.ts';
import { turnsRepo } from '../repo/turns.ts';
import { chatsRepo } from '../repo.ts';
import type { ChatBus } from './bus.ts';

/**
 * The decision log in a chat's turns (2026-11-14, docs/processes.md "Decisions"): the port the decisions module
 * implements and `app.ts` passes in, so the chats module stores nothing of decisions itself. Every message turn of
 * every agent (its own chats, a task's step, a Lead's chats, the team room, a Slack conversation) gets the
 * `record_decision` tool and one line of standing instructions when its runner offers it (`caps.decisions`). A call
 * runs on the turn's write queue, after the events the runner sent before it, so the decision knows the turn's last
 * event (where the thread shows it); the stored decision goes to the chat's stream (`decision`).
 */

/** A turn's decision as the hook stores it: the turn, its chat, the agent, the task and contact it belongs to. */
export interface DecisionTurn {
  readonly turnId: string;
  readonly chatId: string;
  readonly agentId: string;
  /** The agent as the audit names it. */
  readonly agentPrincipalId: string;
  /** The task whose step the turn belongs to; null for any other turn. */
  readonly taskId: string | null;
  /** The contact the conversation is with; null until the contacts land (`contactOf`). */
  readonly contactId: string | null;
  /** The turn's last event stored before the call. */
  readonly eventSeq: number;
}

/** What a call came to: the tool's answer, and the decision when one was stored. */
export interface DecisionRecorded {
  readonly reply: TurnToolReply;
  readonly decision?: DecisionView | undefined;
}

/** The decisions module's side; never throws (a refusal is a tool error in words). */
export interface DecisionsHook {
  record(t: TenantDb, turn: DecisionTurn, input: unknown): Promise<DecisionRecorded>;
}

/**
 * The contact a turn's conversation is with. TODO(contacts): once the contacts branch adds `contact_id` to Slack chats
 * and their turns, answer `turn.contactId ?? chat.contactId`; until then no chat names one.
 */
export const contactOf = (_chat: Chat, _turn: ChatTurn): string | null => null;

/**
 * What a turn's spec adds for the decision log on top of the agents' tools so far (`plan`): the tool's name after
 * theirs, and its line after the standing instructions so far (left out when it would not fit); nothing for a turn
 * that is no message, a runner that does not offer it, or without the hook.
 */
export function withDecisionTool(
  plan: { readonly tools?: string[]; readonly instructions?: string },
  turn: {
    readonly hook: DecisionsHook | undefined;
    readonly offers: boolean;
    readonly kind: ChatTurnKind;
    readonly instructions: string | undefined;
  },
): { readonly tools?: string[]; readonly instructions?: string } {
  if (turn.hook === undefined || !turn.offers || turn.kind !== 'message') return plan;
  const before = plan.instructions ?? turn.instructions;
  const joined = before === undefined ? DECISION_LINE : `${before}\n\n${DECISION_LINE}`;
  const instructions = joined.length <= STANDING_INSTRUCTIONS_MAX ? joined : plan.instructions;
  return {
    tools: [...(plan.tools ?? []), DECISION_TOOL],
    ...(instructions === undefined ? {} : { instructions }),
  };
}

/** True for a call of the decision log's tool. */
export const isDecisionCall = (call: TurnToolCall): boolean => call.tool === DECISION_TOOL;

/** A `record_decision` call (see above), answered once its turn's earlier writes are done. */
export async function decisionCall(
  hook: DecisionsHook,
  run: (work: () => Promise<void>) => Promise<void>,
  t: TenantDb,
  of: {
    readonly turn: ChatTurn;
    readonly agentPrincipalId: string;
    readonly taskId: string | undefined;
    readonly bus: ChatBus;
  },
  call: TurnToolCall,
): Promise<TurnToolReply> {
  const { turn, bus } = of;
  let reply: TurnToolReply = {
    ok: false,
    text: 'The decision was not recorded; call record_decision again.',
  };
  await run(async () => {
    const chat = (await chatsRepo.get(t, turn.chatId)) as Chat;
    const recorded = await hook.record(
      t,
      {
        turnId: turn.id,
        chatId: chat.id,
        agentId: chat.agentId,
        agentPrincipalId: of.agentPrincipalId,
        taskId: of.taskId ?? chat.taskId,
        contactId: contactOf(chat, turn),
        eventSeq: await turnsRepo.lastEventSeq(t, turn.id),
      },
      call.input,
    );
    reply = recorded.reply;
    if (recorded.decision !== undefined)
      bus.publish(chat.id, { kind: 'decision', decision: recorded.decision });
  });
  return reply;
}
