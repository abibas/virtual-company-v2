import type { DbHandle, TenantDb } from '@mwc/db';
import { CHAT_STREAM_HEARTBEAT_MS } from '@mwc/shared/chats';
import { participantsRepo } from '../repo/participants.ts';
import { chatsRepo } from '../repo.ts';
import { isMessageChat } from '../rules/people.ts';
import type { ChatActivityView, ChatListItemView } from '../schemas/activity.ts';
import type { ChatActivity, ChatBus } from './bus.ts';
import { listItems } from './faces.ts';
import type { StreamTimers } from './stream.ts';

/**
 * The company's chats, live (2026-11-13, docs/harness.md "Live chat lists"; `GET …/chat-activity`, Server-Sent Events):
 * a `chat` message (`{chat, lastTurn}`, the chat as it is now and its latest turn) each time one of the company's chats
 * with its agents is begun, renamed or archived, or one of its turns is queued, starts, changes status or goes, or its
 * agent asks a question; so an agent's chat list and the rail's chats move without a reload, whichever path made the
 * turn (a person, a Slack message, a Lead's wake-up, the team room, a step's turn, a wait that ended). Every other
 * company's chat is left out: each chat is read through the caller's tenant, once per burst of its messages, and one that
 * is not the company's is never read again. Since 2026-11-14 a message chat goes only to the people in it (docs/harness.md
 * "Who is in a chat"), read again at each burst, so a person added hears it from then on; a task's conversation goes to
 * everyone, as its task's page opens it to anyone who reads chats, named by its task (`forTask`, T-19: the agent's chat
 * list shows it apart). A `: heartbeat` comment every 20 s; nothing is replayed (a page that reconnects reads its lists
 * again).
 */

/** Where the messages go (the route writes them as Server-Sent Events). */
export interface ActivitySink {
  message(event: 'chat', data: string): Promise<void>;
  comment(text: string): Promise<void>;
}

export interface ActivityDeps {
  readonly db: DbHandle;
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

/**
 * The chat as the activity sends it to `viewer` (a principal); `elsewhere` for another company's chat, never read again;
 * `hidden` for a message chat they are not in, read again at its next burst.
 */
export async function activityOf(
  db: DbHandle,
  t: TenantDb,
  chatId: string,
  viewer: string,
): Promise<ChatActivityView | 'elsewhere' | 'hidden'> {
  const chat = await chatsRepo.get(t, chatId);
  if (chat === undefined) return 'elsewhere';
  if (isMessageChat(chat) && !(await participantsRepo.has(t, chat.id, viewer))) return 'hidden';
  const [item] = (await listItems(db, t, [chat])) as [ChatListItemView];
  return { chat: item, lastTurn: item.lastTurn };
}

/** Streams the company's chats' activity to `sink` until `closed` resolves (see above). */
export async function streamActivity(
  deps: ActivityDeps,
  t: TenantDb,
  viewer: string,
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
    const view = await activityOf(deps.db, t, chatId, viewer);
    if (view === 'elsewhere') elsewhere.add(chatId);
    else if (view !== 'hidden') await sink.message('chat', JSON.stringify(view));
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
