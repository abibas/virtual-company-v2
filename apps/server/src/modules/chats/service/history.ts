import { aiPartOf, type Chat, type ChatTurn, type TenantDb } from '@mwc/db';
import { CHAT_WINDOW } from '@mwc/shared/chats';
import { HARNESS_PROVIDER } from '@mwc/shared/credentials';
import { profileWindowOf } from '@mwc/shared/harness';
import { historyRepo } from '../repo/history.ts';
import { profilesRepo } from '../repo/profiles.ts';
import { turnsRepo } from '../repo/turns.ts';
import { chatsRepo } from '../repo.ts';
import { conversationsBefore } from '../rules/history.ts';
import { CHAT_NOT_FOUND, type ConversationState, conversationState, type Refusal } from '../rules.ts';
import type { ChatEarlierView, OlderTurnsQuery } from '../schemas/history.ts';
import type { ChatTurnWithEventsView } from '../schemas.ts';
import { eventView, turnView } from './views.ts';

/**
 * A long chat, read a window at a time (docs/harness.md "Reading a long chat"): the chat's detail holds its current
 * conversation (the turns since its last Clear, that Clear first), the latest `CHAT_WINDOW` of them, and says what it
 * left out (`earlier`); the older turns page in by number. What the conversation runs on and how full it is
 * (`conversationState`) still reads the whole current conversation: the left-out turns' `init`, `context` and `compact`
 * events only; when they name no window, the window is that of what the chat's access profile runs.
 */

/** The turns with their events, in order. */
async function withEvents(t: TenantDb, rows: readonly ChatTurn[]): Promise<ChatTurnWithEventsView[]> {
  const events = await turnsRepo.eventsOf(
    t,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    ...turnView(row),
    events: events.filter((event) => event.turnId === row.id).map(eventView),
  }));
}

/** The left-out turns of the current conversation as `conversationState` reads them: their state events only. */
async function leftOutState(t: TenantDb, chatId: string, fromSeq: number, beforeSeq: number) {
  const { turns, events } = await historyRepo.stateOf(t, chatId, { fromSeq, beforeSeq });
  return turns.map((turn) => ({
    kind: turn.kind,
    events: events.filter((event) => event.turnId === turn.id).map(eventView),
  }));
}

export interface CurrentConversation {
  readonly turns: ChatTurnWithEventsView[];
  readonly earlier: ChatEarlierView;
  readonly state: ConversationState;
}

/** The window of what the chat runs (its own access profile, else its agent's); null without one. */
async function profileWindow(t: TenantDb, chat: Chat): Promise<number | null> {
  const profileId = chat.profileId ?? (await chatsRepo.agentOf(t, chat.agentId))?.profileId ?? null;
  const profile = profileId === null ? undefined : await profilesRepo.get(t, profileId);
  const provider = HARNESS_PROVIDER[chat.harness];
  const part = profile === undefined ? undefined : aiPartOf(profile, provider);
  return part === undefined ? null : profileWindowOf(provider, part.model);
}

/** The chat's current conversation, its latest turns with their events, and what is left out (see above). */
export async function currentConversation(t: TenantDb, chat: Chat): Promise<CurrentConversation> {
  const chatId = chat.id;
  const clears = await historyRepo.clearsOf(t, chatId);
  const fromSeq = clears.at(-1)?.seq ?? 1;
  const rows = await historyRepo.latestOf(t, chatId, { fromSeq }, CHAT_WINDOW);
  const first = rows[0]?.seq ?? fromSeq;
  const leftOut =
    rows.length < CHAT_WINDOW ? 0 : await historyRepo.countOf(t, chatId, { fromSeq, beforeSeq: first });
  const turns = await withEvents(t, rows);
  const before = leftOut === 0 ? [] : await leftOutState(t, chatId, fromSeq, first);
  const spans = await historyRepo.spansOf(
    t,
    chatId,
    clears.map((clear) => clear.seq),
  );
  return {
    turns,
    state: conversationState([...before, ...turns], await profileWindow(t, chat)),
    earlier: {
      before: leftOut === 0 ? null : first,
      turns: leftOut,
      conversations: conversationsBefore(clears, spans),
    },
  };
}

/**
 * The chat's turns before `beforeSeq` and after `afterSeq` (both exclusive; 0 by default), the latest `limit` of them in
 * order with their events, and whether older ones exist in that range; 404 for an unknown chat.
 */
export async function olderTurns(
  t: TenantDb,
  chatId: string,
  query: OlderTurnsQuery,
): Promise<{ ok: true; turns: ChatTurnWithEventsView[]; more: boolean } | Refusal> {
  const chat = await chatsRepo.get(t, chatId);
  if (chat === undefined) return CHAT_NOT_FOUND;
  const range = { fromSeq: (query.afterSeq ?? 0) + 1, beforeSeq: query.beforeSeq };
  const rows = await historyRepo.latestOf(t, chat.id, range, query.limit + 1);
  const more = rows.length > query.limit;
  return { ok: true, turns: await withEvents(t, more ? rows.slice(1) : rows), more };
}
