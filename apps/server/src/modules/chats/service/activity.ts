import type { TenantDb } from '@mwc/db';
import { CHAT_STREAM_HEARTBEAT_MS } from '@mwc/shared/chats';
import { turnsRepo } from '../repo/turns.ts';
import { chatsRepo } from '../repo.ts';
import type { ChatActivityView } from '../schemas/activity.ts';
import type { ChatActivity, ChatBus } from './bus.ts';
import type { StreamTimers } from './stream.ts';
import { chatView, turnView } from './views.ts';

/**
 * The company's chats, live (2026-11-13, docs/harness.md "Live chat lists"; `GET …/chat-activity`, Server-Sent Events):
 * a `chat` message (`{chat, lastTurn}`, the chat as it is now and its latest turn) each time one of the company's chats
 * with its agents is begun, renamed or archived, or one of its turns is queued, starts, changes status or goes, or its
 * agent asks a question; so an agent's chat list and the rail's chats move without a reload, whichever path made the
 * turn (a person, a Slack message, a Lead's wake-up, the team room, a wait that ended). A task's conversation is left
 * out (it is not in the agent's list) and so is every other company's chat: each chat is read through the caller's
 * tenant, once per burst of its messages, and one that is not the company's is never read again. A `: heartbeat`
 * comment every 20 s; nothing is replayed (a page that reconnects reads its lists again).
 */

/** Where the messages go (the route writes them as Server-Sent Events). */
export interface ActivitySink {
  message(event: 'chat', data: string): Promise<void>;
  comment(text: string): Promise<void>;
}

export interface ActivityDeps {
  readonly bus: ChatBus;
  readonly timers?: StreamTimers;
  readonly heartbeatMs?: number;
}

const SYSTEM_TIMERS: StreamTimers = {
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

/** Whether a message may change how the chat lists: anything but an event or a decision; of events, a question. */
export const listsAnew = (activity: ChatActivity): boolean =>
  activity.kind === 'event' ? activity.event.event.type === 'question' : activity.kind !== 'decision';

/** The chat as the activity sends it; undefined for another company's chat or a task's conversation. */
export async function activityOf(t: TenantDb, chatId: string): Promise<ChatActivityView | undefined> {
  const chat = await chatsRepo.get(t, chatId);
  if (chat === undefined || chat.taskId !== null) return undefined;
  const last = await turnsRepo.lastOf(t, chat.id);
  return { chat: chatView(chat), lastTurn: last === undefined ? null : turnView(last) };
}

/** Streams the company's chats' activity to `sink` until `closed` resolves (see above). */
export async function streamActivity(
  deps: ActivityDeps,
  t: TenantDb,
  sink: ActivitySink,
  closed: Promise<void>,
): Promise<void> {
  const timers = deps.timers ?? SYSTEM_TIMERS;
  const elsewhere = new Set<string>();
  const pending = new Set<string>();
  // A first comment at once, so the response starts flowing before any heartbeat.
  let chain = sink.comment('open');
  const send = async (chatId: string) => {
    pending.delete(chatId);
    const view = await activityOf(t, chatId);
    if (view === undefined) elsewhere.add(chatId);
    else await sink.message('chat', JSON.stringify(view));
  };
  const unwatch = deps.bus.watch((chatId, activity) => {
    if (elsewhere.has(chatId) || pending.has(chatId) || !listsAnew(activity)) return;
    pending.add(chatId);
    chain = chain.then(() => send(chatId)).catch(() => undefined);
  });
  const heartbeat = timers.setInterval(() => {
    chain = chain.then(() => sink.comment('heartbeat')).catch(() => undefined);
  }, deps.heartbeatMs ?? CHAT_STREAM_HEARTBEAT_MS);
  try {
    await closed;
  } finally {
    unwatch();
    timers.clearInterval(heartbeat);
    await chain.catch(() => undefined);
  }
}
