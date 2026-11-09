import type { TenantDb } from '@mwc/db';
import { CHAT_STREAM_HEARTBEAT_MS, type ChatEventPosition, chatEventId, isAfter } from '@mwc/shared/chats';
import { turnsRepo } from '../repo/turns.ts';
import type { ChatStreamEvent, ChatTurnView } from '../schemas.ts';
import type { ChatBus, ChatMessage } from './bus.ts';
import { streamEvent, turnView } from './views.ts';

/**
 * A chat's stream (S5.1b, `GET …/chats/{chatId}/stream`, Server-Sent Events): `turn` messages (`{turn}`) when a turn
 * starts or changes status, `event` messages (`{turnId, turnSeq, seq, event, at}`) for each event with its id
 * `<turnSeq>.<seq>`, `removed` messages (`{turnId}`) when a waiting message goes (S5.2 step 6; never replayed: a page
 * that reconnects reads the chat's detail again), and a `: heartbeat` comment every 20 s. With a `Last-Event-ID` it first sends what came after it:
 * the turns from that one on (as they are now) and their later events, then the live messages, an event never twice.
 * It listens before it reads, so nothing that happens during the replay is lost.
 */

/** Where the messages go (the route writes them as Server-Sent Events). */
export interface StreamSink {
  message(event: 'turn' | 'event' | 'removed', data: string, id?: string): Promise<void>;
  comment(text: string): Promise<void>;
}

export interface StreamTimers {
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface StreamDeps {
  readonly bus: ChatBus;
  readonly timers?: StreamTimers;
  readonly heartbeatMs?: number;
}

const SYSTEM_TIMERS: StreamTimers = {
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

/** The position of an event in its chat. */
const positionOf = (event: ChatStreamEvent): ChatEventPosition => ({
  turnSeq: event.turnSeq,
  eventSeq: event.seq,
});

/** Streams the chat to `sink` until `closed` resolves (see above). */
export async function streamChat(
  deps: StreamDeps,
  t: TenantDb,
  chatId: string,
  after: ChatEventPosition | undefined,
  sink: StreamSink,
  closed: Promise<void>,
): Promise<void> {
  const timers = deps.timers ?? SYSTEM_TIMERS;
  let last = after;
  // A first comment at once, so the response starts flowing (proxies and fetch see it open) before any heartbeat.
  let chain = sink.comment('open');
  let buffered: ChatMessage[] | undefined = [];
  const write = (message: ChatMessage) => {
    if (message.kind === 'turn') {
      chain = chain.then(() => sink.message('turn', JSON.stringify({ turn: message.turn })));
      return;
    }
    if (message.kind === 'removed') {
      chain = chain.then(() => sink.message('removed', JSON.stringify({ turnId: message.turnId })));
      return;
    }
    const position = positionOf(message.event);
    if (last !== undefined && !isAfter(position, last)) return;
    last = position;
    chain = chain.then(() => sink.message('event', JSON.stringify(message.event), chatEventId(position)));
  };
  const unsubscribe = deps.bus.subscribe(chatId, (message) => {
    if (buffered === undefined) write(message);
    else buffered.push(message);
  });
  const heartbeat = timers.setInterval(() => {
    chain = chain.then(() => sink.comment('heartbeat'));
  }, deps.heartbeatMs ?? CHAT_STREAM_HEARTBEAT_MS);
  try {
    if (after !== undefined) for (const message of await replay(t, chatId, after)) write(message);
    for (const message of buffered) write(message);
    buffered = undefined;
    await closed;
  } finally {
    unsubscribe();
    timers.clearInterval(heartbeat);
    await chain.catch(() => undefined);
  }
}

/** What came after `after`: the turns from its turn on, each followed by its later events. */
async function replay(t: TenantDb, chatId: string, after: ChatEventPosition): Promise<ChatMessage[]> {
  const turns = await turnsRepo.ofChat(t, chatId, after.turnSeq);
  const events = await turnsRepo.eventsOf(
    t,
    turns.map((turn) => turn.id),
  );
  const messages: ChatMessage[] = [];
  for (const turn of turns) {
    const view: ChatTurnView = turnView(turn);
    messages.push({ kind: 'turn', turn: view });
    for (const row of events.filter((event) => event.turnId === turn.id)) {
      messages.push({ kind: 'event', event: streamEvent(turn, row) });
    }
  }
  return messages;
}
