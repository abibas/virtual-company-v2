import type { Chat, ChatTurn, TenantDb } from '@mwc/db';
import { CHAT_QUEUE_MAX } from '@mwc/shared/chats';
import type { ChatTurnDelivery } from '@mwc/shared/enums';
import { newId } from '@mwc/shared/ids';
import { queueRepo } from '../repo/queue.ts';
import { turnsRepo } from '../repo/turns.ts';
import { chatsRepo } from '../repo.ts';
import { MESSAGE_SENT, nowRefusal, QUEUE_FULL, TURN_NOT_QUEUED } from '../rules/queue.ts';
import { CHAT_ARCHIVED, CHAT_NOT_FOUND, type Refusal, TURN_NOT_FOUND } from '../rules.ts';
import type { ChatTurnView } from '../schemas.ts';
import type { ChatQueue } from './drain.ts';
import { startTurn, type TurnCaller, type TurnsDeps } from './turns.ts';
import { turnView } from './views.ts';

/**
 * Messages sent while the agent works (S5.2 step 6, docs/harness.md "Delivery while a turn runs"). Without a delivery a
 * prompt starts a turn or is refused while one runs (`turn_running`, as before). With one, a chat with nothing running
 * or waiting starts it at once; otherwise it waits as a queued turn (at most `CHAT_QUEUE_MAX`): `after` for the running
 * turn's end, `interrupt` stops the running turn (its stop ladder) and starts first, `now` goes into the running turn
 * as well (Claude Code's message turns only) and starts first if the turn ends without taking it (its `input` event
 * removes it). A waiting message can be edited, discarded, sent Now or made to interrupt, while it still waits; one
 * already sent Now cannot. Every change is told to the chat's stream.
 */

export interface QueueDeps extends TurnsDeps {
  readonly queue: ChatQueue;
}

type Answer = { readonly ok: true; readonly turn: ChatTurnView } | Refusal;

/** The chat, unless it is unknown (404) or archived (409). */
async function openChat(t: TenantDb, chatId: string): Promise<Chat | Refusal> {
  const chat = await chatsRepo.get(t, chatId);
  if (chat === undefined) return CHAT_NOT_FOUND;
  return chat.archivedAt === null ? chat : CHAT_ARCHIVED;
}

/** The chat's waiting turn that can still change, or why not. */
async function waitingTurn(t: TenantDb, chatId: string, turnId: string) {
  const chat = await openChat(t, chatId);
  if (!('id' in chat)) return chat;
  const turn = await turnsRepo.get(t, chat.id, turnId);
  if (turn === undefined) return TURN_NOT_FOUND;
  if (turn.status !== 'queued') return TURN_NOT_QUEUED;
  if (turn.delivery === 'now') return MESSAGE_SENT;
  return { chat, turn };
}

const publish = (deps: TurnsDeps, turn: ChatTurn) => {
  const view = turnView(turn);
  deps.live.bus.publish(turn.chatId, { kind: 'turn', turn: view });
  return view;
};

/**
 * What a waiting turn's delivery does to the running turn (the message goes into it, or it stops), then the next
 * waiting turn starts if none runs; the turn as it is now.
 */
async function deliver(deps: QueueDeps, t: TenantDb, turn: ChatTurn, running: ChatTurn | undefined) {
  if (running !== undefined && turn.delivery === 'now') deps.live.input(running.id, turn.id, turn.prompt);
  if (running !== undefined && turn.delivery === 'interrupt') deps.live.stop(running.id);
  await deps.queue.startNext(t, turn.chatId);
  const now = await turnsRepo.get(t, turn.chatId, turn.id);
  return { ok: true as const, turn: turnView(now ?? turn) };
}

/** Sends a message to the chat with its delivery while a turn runs (see above); 202 with its turn, or why not. */
export async function sendMessage(
  deps: QueueDeps,
  t: TenantDb,
  caller: TurnCaller,
  chatId: string,
  prompt: string,
  delivery: ChatTurnDelivery | undefined,
): Promise<Answer> {
  if (delivery === undefined) return startTurn(deps, t, caller, chatId, prompt);
  const chat = await openChat(t, chatId);
  if (!('id' in chat)) return chat;
  const running = await queueRepo.runningOf(t, chat.id);
  const waiting = await queueRepo.queuedOf(t, chat.id);
  if (running === undefined && waiting.length === 0) return startTurn(deps, t, caller, chat.id, prompt);
  const refused = delivery === 'now' && running !== undefined ? nowRefusal(chat, running) : undefined;
  if (refused !== undefined) return refused;
  if (waiting.length >= CHAT_QUEUE_MAX) return QUEUE_FULL;
  const turn = await t.transaction(async (tx) => {
    const seq = (await turnsRepo.lastSeq(tx, chat.id)) + 1;
    const values = { id: newId(), chatId: chat.id, seq, prompt, delivery, createdBy: caller.principalId };
    return turnsRepo.insert(tx, { ...values, status: 'queued' });
  });
  publish(deps, turn);
  return deliver(deps, t, turn, running);
}

/** Changes a waiting message's prompt; 200 with its turn, or why not. */
export async function editQueued(
  deps: TurnsDeps,
  t: TenantDb,
  chatId: string,
  turnId: string,
  prompt: string,
): Promise<Answer> {
  const found = await waitingTurn(t, chatId, turnId);
  if (!('turn' in found)) return found;
  const row = await queueRepo.updateQueued(t, found.chat.id, found.turn.id, { prompt });
  return row === undefined ? TURN_NOT_QUEUED : { ok: true, turn: publish(deps, row) };
}

/** Discards a waiting message (its turn goes, told to the stream as `removed`); or why not. */
export async function discardQueued(
  deps: TurnsDeps,
  t: TenantDb,
  chatId: string,
  turnId: string,
): Promise<{ readonly ok: true } | Refusal> {
  const found = await waitingTurn(t, chatId, turnId);
  if (!('turn' in found)) return found;
  const gone = await queueRepo.deleteQueued(t, found.chat.id, found.turn.id);
  if (gone === undefined) return TURN_NOT_QUEUED;
  deps.live.bus.publish(gone.chatId, { kind: 'removed', turnId: gone.id });
  return { ok: true };
}

/** Sends a waiting message Now, or makes it interrupt the running turn; 202 with its turn, or why not. */
export async function deliverQueued(
  deps: QueueDeps,
  t: TenantDb,
  chatId: string,
  turnId: string,
  delivery: 'now' | 'interrupt',
): Promise<Answer> {
  const found = await waitingTurn(t, chatId, turnId);
  if (!('turn' in found)) return found;
  const running = await queueRepo.runningOf(t, found.chat.id);
  const refused = delivery === 'now' && running !== undefined ? nowRefusal(found.chat, running) : undefined;
  if (refused !== undefined) return refused;
  const row = await queueRepo.updateQueued(t, found.chat.id, found.turn.id, { delivery });
  if (row === undefined) return TURN_NOT_QUEUED;
  publish(deps, row);
  return deliver(deps, t, row, running);
}
