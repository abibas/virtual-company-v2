import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addEvent,
  carryOlder,
  conversationStart,
  lastEventId,
  removeTurn,
  upsertTurn,
} from './chat-turns.ts';
import { type ChatCalls, chatCalls } from './chats.ts';
import { useApi } from './context.ts';
import { type Decision, useChatDecisions } from './decisions.ts';
import { readEventStream, type StreamMessage } from './event-stream.ts';
import type {
  Chat,
  ChatConversation,
  ChatDetail,
  ChatStreamEvent,
  ChatTurn,
  ChatTurnWithEvents,
} from './types.ts';
import { type Loaded, useLoad } from './use-load.ts';

/**
 * One chat, live (S5.1c): its detail (the current conversation's latest turns), then its stream from where the detail
 * stands (`Last-Event-ID`), each turn and event merged in, and the current conversation's older turns a page at a time.
 * A dropped stream (an error, the end, 50 s of silence) reloads the detail a little later, and the fresh detail opens
 * the stream again from its own position, so nothing is missed or shown twice; older pages stay while they still reach
 * it. A Clear reloads the detail too, so the conversation it ended becomes one of its folded `conversations`. The
 * decisions its agent recorded (2026-11-14) load beside it, again with each fresh detail, and come live on the stream.
 */

/** `live`: the stream is open; `reconnecting`: it dropped and comes back; `gone`: the chat is not there any more. */
export type StreamState = 'connecting' | 'live' | 'reconnecting' | 'gone';

export interface ChatLive {
  readonly detail: Loaded<ChatDetail>;
  /** The chat's fields: the detail's, or the last change the page made. */
  readonly chat: Chat | undefined;
  /** The current conversation as loaded: older pages, the detail's window, then what the stream added. */
  readonly turns: readonly ChatTurnWithEvents[];
  readonly earlier: ChatEarlierLive;
  readonly stream: StreamState;
  /** The decisions its agent recorded in it (none for a viewer, who may not read them). */
  readonly decisions: readonly Decision[];
  /** A turn the page started or stopped (the API's answer), shown before the stream says so. */
  putTurn(turn: ChatTurn): void;
  /** A waiting message the page discarded (S5.2 step 6), gone before the stream says so. */
  dropTurn(turnId: string): void;
  /** The chat after a change the page made (its profile). */
  putChat(chat: Chat): void;
}

/** What the detail left out, and the loading of the current conversation's older turns. */
export interface ChatEarlierLive {
  /** The conversations before each Clear, newest first (their turns load apart: `useEarlierConversations`). */
  readonly conversations: readonly ChatConversation[];
  /** Older turns of the current conversation are left out. */
  readonly more: boolean;
  /** About how many: the detail's count less the pages loaded since. */
  readonly left: number;
  readonly loading: boolean;
  readonly error: unknown;
  loadOlder(): Promise<void>;
}

interface Merged {
  readonly from: ChatDetail | undefined;
  /** The detail's window, with what the stream and the page added. */
  readonly turns: readonly ChatTurnWithEvents[];
  readonly chat: Chat | undefined;
  /** Older turns of the current conversation loaded a page at a time, before the window. */
  readonly older: readonly ChatTurnWithEvents[];
  /** Older turns of the current conversation are still left out. */
  readonly more: boolean;
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
function useStream(
  calls: ChatCalls,
  chatId: string,
  detail: Loaded<ChatDetail>,
  on: { readonly apply: Apply; readonly decision: (decision: Decision) => void },
): StreamState {
  const { apply, decision } = on;
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
      } else if (m.event === 'decision') {
        const recorded = parsed<{ decision: Decision }>(m.data)?.decision;
        if (recorded) decision(recorded);
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
  }, [base, calls, chatId, apply, decision, reload]);
  useEffect(() => {
    if (error === undefined || stream !== 'reconnecting') return;
    const retry = setTimeout(reload, backoff(failures.current));
    failures.current += 1;
    return () => clearTimeout(retry);
  }, [error, stream, reload]);
  return stream;
}

/** Where the merged turns stand on a fresh detail: its window, and the older pages still shown before it. */
function rebase(m: Merged, base: ChatDetail | undefined): Merged {
  if (base === undefined) return { from: base, turns: [], chat: undefined, older: [], more: false };
  const older = carryOlder([...m.older, ...m.turns], base);
  return { from: base, turns: base.turns, chat: undefined, older, more: base.earlier.turns > older.length };
}

const NOTHING: Merged = { from: undefined, turns: [], chat: undefined, older: [], more: false };

/**
 * "Load older messages": the page before the first turn shown, inside the current conversation, put before it unless
 * the turns moved meanwhile (a fresh detail); one load at a time.
 */
function useOlder(
  calls: ChatCalls,
  chatId: string,
  base: ChatDetail | undefined,
  first: number | undefined,
  apply: Apply,
) {
  const [state, setState] = useState<{ loading: boolean; error: unknown }>({
    loading: false,
    error: undefined,
  });
  const busy = useRef(false);
  const load = useCallback(async () => {
    if (busy.current || base === undefined || first === undefined) return;
    busy.current = true;
    setState({ loading: true, error: undefined });
    try {
      const page = await calls.older(chatId, { beforeSeq: first, afterSeq: conversationStart(base) - 1 });
      apply((m) =>
        (m.older[0] ?? m.turns[0])?.seq === first
          ? { ...m, older: [...page.turns, ...m.older], more: page.more }
          : m,
      );
      setState({ loading: false, error: undefined });
    } catch (error) {
      setState({ loading: false, error });
    } finally {
      busy.current = false;
    }
  }, [calls, chatId, base, first, apply]);
  return { ...state, load };
}

/** The chat's decisions again with each detail after the first (a reconnect), for those the dropped stream missed. */
function useFreshDecisions(base: ChatDetail | undefined, reload: () => void) {
  const first = useRef<ChatDetail | undefined>(undefined);
  useEffect(() => {
    if (base === undefined) return;
    if (first.current === undefined) first.current = base;
    else if (first.current !== base) reload();
  }, [base, reload]);
}

export function useChatLive(companyId: string, chatId: string): ChatLive {
  const api = useApi();
  const calls = useMemo(() => chatCalls(api, companyId), [api, companyId]);
  const detail = useLoad(`chat:${companyId}:${chatId}`, () => calls.get(chatId));
  const base = detail.data;
  const [merged, setMerged] = useState<Merged>(NOTHING);
  // Every change starts from the turns of the detail on screen: a fresh detail replaces what the stream had added.
  const apply = useCallback<Apply>(
    (change) => setMerged((m) => change(m.from === base ? m : rebase(m, base))),
    [base],
  );
  const recorded = useChatDecisions(companyId, chatId);
  const stream = useStream(calls, chatId, detail, { apply, decision: recorded.put });
  useFreshDecisions(base, recorded.reload);
  const current = merged.from === base ? merged : rebase(merged, base);
  const turns = useMemo(() => [...current.older, ...current.turns], [current.older, current.turns]);
  const older = useOlder(calls, chatId, base, turns[0]?.seq, apply);
  // A Clear made since the detail loaded: the detail again, so the cleared conversation folds into its bar.
  const start = base === undefined ? undefined : conversationStart(base);
  const cleared = start !== undefined && turns.some((turn) => turn.kind === 'clear' && turn.seq > start);
  const { reload } = detail;
  useEffect(() => {
    if (cleared) reload();
  }, [cleared, reload]);
  return {
    detail,
    chat: current.chat ?? base,
    turns,
    stream,
    decisions: recorded.decisions,
    earlier: {
      conversations: base?.earlier.conversations ?? [],
      more: current.more,
      left: Math.max(0, (base?.earlier.turns ?? 0) - current.older.length),
      loading: older.loading,
      error: older.error,
      loadOlder: older.load,
    },
    putTurn: (turn) => apply((m) => ({ ...m, turns: upsertTurn(m.turns, turn) })),
    dropTurn: (turnId) => apply((m) => ({ ...m, turns: removeTurn(m.turns, turnId) })),
    putChat: (chat) => apply((m) => ({ ...m, chat })),
  };
}
