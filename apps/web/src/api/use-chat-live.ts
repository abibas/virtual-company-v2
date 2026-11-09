import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addEvent, lastEventId, removeTurn, upsertTurn } from './chat-turns.ts';
import { type ChatCalls, chatCalls } from './chats.ts';
import { useApi } from './context.ts';
import { readEventStream, type StreamMessage } from './event-stream.ts';
import type { Chat, ChatDetail, ChatStreamEvent, ChatTurn, ChatTurnWithEvents } from './types.ts';
import { type Loaded, useLoad } from './use-load.ts';

/**
 * One chat, live (S5.1c): its detail, then its stream from where the detail stands (`Last-Event-ID`), each turn and
 * event merged in. A dropped stream (an error, the end, 50 s of silence) reloads the detail a little later, and the
 * fresh detail opens the stream again from its own position, so nothing is missed or shown twice.
 */

/** `live`: the stream is open; `reconnecting`: it dropped and comes back; `gone`: the chat is not there any more. */
export type StreamState = 'connecting' | 'live' | 'reconnecting' | 'gone';

export interface ChatLive {
  readonly detail: Loaded<ChatDetail>;
  /** The chat's fields: the detail's, or the last change the page made. */
  readonly chat: Chat | undefined;
  readonly turns: readonly ChatTurnWithEvents[];
  readonly stream: StreamState;
  /** A turn the page started or stopped (the API's answer), shown before the stream says so. */
  putTurn(turn: ChatTurn): void;
  /** A waiting message the page discarded (S5.2 step 6), gone before the stream says so. */
  dropTurn(turnId: string): void;
  /** The chat after a change the page made (its profile). */
  putChat(chat: Chat): void;
}

interface Merged {
  readonly from: ChatDetail | undefined;
  readonly turns: readonly ChatTurnWithEvents[];
  readonly chat: Chat | undefined;
}

/** The wait before the next try: 1 s, doubled after each failure in a row, at most 15 s. */
const backoff = (failures: number) => Math.min(15_000, 1000 * 2 ** Math.min(failures, 4));

function parsed<T>(data: string): T | undefined {
  try {
    return JSON.parse(data) as T;
  } catch {
    return undefined;
  }
}

/** Opens the stream once and reads it to its end; true when the chat is gone (404), so no reconnect is useful. */
async function readOnce(
  calls: ChatCalls,
  chatId: string,
  from: string,
  signal: AbortSignal,
  on: { readonly message: (m: StreamMessage) => void; readonly open: () => void },
): Promise<boolean> {
  const response = await calls.stream(chatId, from, signal);
  if (response.status === 404) return true;
  if (!response.ok || response.body === null) throw new Error(`stream answered ${response.status}`);
  on.open();
  await readEventStream(response.body, on.message, on.open);
  return false;
}

type Apply = (change: (m: Merged) => Merged) => void;

/**
 * The stream of the loaded detail `base`, opened from where it stands; a drop reloads the detail (`reload`) after a
 * wait, and a detail that fails to load while reconnecting (the server is down) is asked for again, later each time.
 */
function useStream(calls: ChatCalls, chatId: string, detail: Loaded<ChatDetail>, apply: Apply): StreamState {
  const [stream, setStream] = useState<StreamState>('connecting');
  const failures = useRef(0);
  const { data: base, error, reload } = detail;
  useEffect(() => {
    if (base === undefined) return;
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    const message = (m: StreamMessage) => {
      if (m.event === 'turn') {
        const turn = parsed<{ turn: ChatTurn }>(m.data)?.turn;
        if (turn) apply((x) => ({ ...x, turns: upsertTurn(x.turns, turn) }));
      } else if (m.event === 'event') {
        const event = parsed<ChatStreamEvent>(m.data);
        if (event) apply((x) => ({ ...x, turns: addEvent(x.turns, event) }));
      } else if (m.event === 'removed') {
        const turnId = parsed<{ turnId: string }>(m.data)?.turnId;
        if (turnId) apply((x) => ({ ...x, turns: removeTurn(x.turns, turnId) }));
      }
    };
    const open = () => {
      failures.current = 0;
      setStream('live');
    };
    void readOnce(calls, chatId, lastEventId(base.turns), controller.signal, { message, open })
      .catch(() => false)
      .then((gone) => {
        if (controller.signal.aborted) return;
        setStream(gone ? 'gone' : 'reconnecting');
        if (gone) return;
        retry = setTimeout(reload, backoff(failures.current));
        failures.current += 1;
      });
    return () => {
      controller.abort();
      clearTimeout(retry);
    };
  }, [base, calls, chatId, apply, reload]);
  useEffect(() => {
    if (error === undefined || stream !== 'reconnecting') return;
    const retry = setTimeout(reload, backoff(failures.current));
    failures.current += 1;
    return () => clearTimeout(retry);
  }, [error, stream, reload]);
  return stream;
}

export function useChatLive(companyId: string, chatId: string): ChatLive {
  const api = useApi();
  const calls = useMemo(() => chatCalls(api, companyId), [api, companyId]);
  const detail = useLoad(`chat:${companyId}:${chatId}`, () => calls.get(chatId));
  const base = detail.data;
  const [merged, setMerged] = useState<Merged>({ from: undefined, turns: [], chat: undefined });
  // Every change starts from the turns of the detail on screen: a fresh detail replaces what the stream had added.
  const apply = useCallback<Apply>(
    (change) =>
      setMerged((m) =>
        change(m.from === base ? m : { from: base, turns: base?.turns ?? [], chat: undefined }),
      ),
    [base],
  );
  const stream = useStream(calls, chatId, detail, apply);
  const current = merged.from === base ? merged : { turns: base?.turns ?? [], chat: undefined };
  return {
    detail,
    chat: current.chat ?? base,
    turns: current.turns,
    stream,
    putTurn: (turn) => apply((m) => ({ ...m, turns: upsertTurn(m.turns, turn) })),
    dropTurn: (turnId) => apply((m) => ({ ...m, turns: removeTurn(m.turns, turnId) })),
    putChat: (chat) => apply((m) => ({ ...m, chat })),
  };
}
