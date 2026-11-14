import type { Chat, ChatTurn, TenantDb } from '@mwc/db';
import { agentPlacement } from '../../machines/index.ts';
import { turnsRepo } from '../repo/turns.ts';
import { chatsRepo } from '../repo.ts';
import type { TurnFrom } from '../rules/sender.ts';
import {
  AGENT_ARCHIVED,
  AGENT_NOT_FOUND,
  CONTAINER_RUNS_LATER,
  PLACEMENT_MISSING,
  type Refusal,
  refuse,
} from '../rules.ts';
import { auditChat } from './audit.ts';
import type { ChatBus } from './bus.ts';
import { type QueueDeps, sendMessage } from './queue.ts';
import type { SystemTurnEnd } from './task-hook.ts';
import { turnView } from './views.ts';

/**
 * Turns a message from outside asks of an agent (2026-11-13: a Slack message, docs/subscriptions.md "Slack: receiving
 * messages"), the chats module's side, which the integrations module asks through `InboundChats` (passed in by
 * `app.ts`). The conversation's chat goes on while it can (not archived, the agent's harness and machine unchanged),
 * else a new one with the title given is made by Most Wanted (audited as the system); it is one of the agent's own
 * chats, so it shows in its chat list, at once (told to the chats' activity). The message goes there as a turn Most Wanted queued (`system`, the agent as its
 * sender), "after this turn": at once while nothing runs there, else behind the running turn. Every check of a turn
 * holds (the placement, the runner, the profile); a paused agent is not woken. A stopped machine starts when its policy
 * starts it for a message, and the turn waits for it. Its end, as every system turn's, is told to `InboundTurnHook`.
 * Since 2026-11-14 (docs/subscriptions.md "Contacts") the turn stores whom it speaks for (`from`: the sender, the visible
 * text and the contact), and the hook says where it posted the reply, which the turn keeps (`reply_link`) and its
 * stream hears.
 */

export const AGENT_PAUSED_INBOUND = refuse(409, 'agent_paused', 'The agent is paused');

/** What a message asks: the agent, the conversation's chat so far, a new chat's title, the prompt, and why it wakes. */
export interface InboundTurnRequest {
  readonly agentPrincipalId: string;
  /** The conversation's chat so far; null (or one that cannot go on) makes a new one. */
  readonly chatId: string | null;
  readonly title: string;
  readonly prompt: string;
  /** The power log's reason when a stopped machine is started for it. */
  readonly reason: string;
  /** Whom the turn speaks for: the message's sender, its visible text and contact. */
  readonly from?: TurnFrom | undefined;
}

/** Where the message went: the chat (new or not) and its turn; or why not. */
export type InboundTurnSent =
  | { readonly ok: true; readonly chatId: string; readonly turnId: string; readonly created: boolean }
  | Refusal;

/** The port the integrations module calls. */
export interface InboundChats {
  send(t: TenantDb, request: InboundTurnRequest): Promise<InboundTurnSent>;
}

/** Where the hook posted a turn's reply outside: its address (the answer's message in Slack). */
export interface InboundReply {
  readonly link: string;
}

/** What hears the end of every message turn Most Wanted queued (its row closed, or failed before it started). */
export interface InboundTurnHook {
  /** Answers outside; returns where the reply went, if it posted one there. */
  ended(t: TenantDb, end: SystemTurnEnd): Promise<InboundReply | undefined>;
}

/**
 * Tells the hook of a message turn Most Wanted queued that ended (any other turn tells nothing); the reply's address it
 * gives back is kept on the turn and told to the chat's stream.
 */
export async function tellInbound(
  hook: InboundTurnHook | undefined,
  t: TenantDb,
  row: ChatTurn,
  bus: Pick<ChatBus, 'publish'>,
): Promise<void> {
  if (hook === undefined || !row.system || row.kind !== 'message') return;
  const { chatId, id: turnId, roomMessageId, status, resultText, error } = row;
  const reply = await hook.ended(t, { chatId, turnId, roomMessageId, status, resultText, error });
  if (reply === undefined) return;
  const linked = await turnsRepo.setReplyLink(t, turnId, reply.link);
  if (linked !== undefined) bus.publish(chatId, { kind: 'turn', turn: turnView(linked) });
}

/** The conversation's chat if it can go on, else a new one; or why the agent cannot take a turn. */
async function conversationChat(
  deps: QueueDeps,
  t: TenantDb,
  request: InboundTurnRequest,
): Promise<{ readonly chat: Chat; readonly created: boolean } | Refusal> {
  const agent = await chatsRepo.agentByPrincipal(t, request.agentPrincipalId);
  if (agent === undefined) return AGENT_NOT_FOUND;
  if (agent.status === 'archived') return AGENT_ARCHIVED;
  if (agent.status === 'paused') return AGENT_PAUSED_INBOUND;
  const placed = await agentPlacement(t, agent.id);
  const placement = placed.ok ? placed.placement : null;
  if (placement === null) return PLACEMENT_MISSING;
  if (placement.mode === 'container') return CONTAINER_RUNS_LATER;
  const found = request.chatId === null ? undefined : await chatsRepo.get(t, request.chatId);
  const goesOn =
    found !== undefined &&
    found.agentId === agent.id &&
    found.archivedAt === null &&
    found.harness === agent.harness &&
    found.machineId === placement.machineId;
  if (goesOn) return { chat: found, created: false };
  const chat = await chatsRepo.insert(t, {
    agentId: agent.id,
    harness: agent.harness,
    machineId: placement.machineId,
    title: request.title,
    createdBy: agent.principalId,
  });
  await auditChat(t, null, chat, 'create', null);
  deps.live.bus.changed(chat.id);
  return { chat, created: true };
}

/** The inbound chats over the chats' queue (see above). */
export function inboundChats(deps: QueueDeps): InboundChats {
  return {
    async send(t, request) {
      const found = await conversationChat(deps, t, request);
      if (!('chat' in found)) return found;
      const { chat, created } = found;
      const wake = { trigger: 'message' as const, reason: request.reason };
      const caller = { principalId: request.agentPrincipalId, system: true, wake, from: request.from };
      const sent = await sendMessage(deps, t, caller, chat.id, request.prompt, 'after');
      if (!sent.ok) return sent;
      if (sent.turn.status === 'failed')
        return refuse(409, sent.turn.error ?? 'turn_failed', `The turn could not start (${sent.turn.error})`);
      return { ok: true, chatId: chat.id, turnId: sent.turn.id, created };
    },
  };
}
