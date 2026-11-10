import { CHAT_PAGE } from '@mwc/shared/chats';
import { useCallback, useRef, useState } from 'react';
import type { ChatCalls } from './chats.ts';
import type { ChatConversation, ChatTurnWithEvents } from './types.ts';

/**
 * The conversations before a chat's Clears, loaded when the person opens one (docs/harness.md "Reading a long chat"):
 * all its turns, a page of 50 at a time from its Clear back to the previous one, once; kept while the chat is open
 * (a failure can be tried again).
 */

export type EarlierTurns =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly error: unknown }
  | { readonly status: 'loaded'; readonly turns: readonly ChatTurnWithEvents[] };

export interface EarlierConversations {
  /** By the id of the Clear that ended each conversation. */
  readonly loaded: ReadonlyMap<string, EarlierTurns>;
  /** Loads a conversation's turns, unless they are loaded or loading; `afterSeq` is the previous Clear's number (0). */
  load(conversation: ChatConversation, afterSeq: number): void;
}

/** Every turn between the two Clears, oldest first. */
async function allTurns(calls: ChatCalls, chatId: string, beforeSeq: number, afterSeq: number) {
  let turns: ChatTurnWithEvents[] = [];
  let before = beforeSeq;
  for (;;) {
    const page = await calls.older(chatId, { beforeSeq: before, afterSeq, limit: CHAT_PAGE.max });
    turns = [...page.turns, ...turns];
    const first = page.turns[0];
    if (!page.more || first === undefined) return turns;
    before = first.seq;
  }
}

export function useEarlierConversations(calls: ChatCalls, chatId: string): EarlierConversations {
  const [state, setState] = useState<{ chatId: string; loaded: ReadonlyMap<string, EarlierTurns> }>({
    chatId,
    loaded: new Map(),
  });
  const loaded = state.chatId === chatId ? state.loaded : new Map<string, EarlierTurns>();
  const seen = useRef(loaded);
  seen.current = loaded;
  const put = useCallback(
    (id: string, value: EarlierTurns) =>
      setState((s) => {
        const next = new Map(s.chatId === chatId ? s.loaded : []);
        next.set(id, value);
        return { chatId, loaded: next };
      }),
    [chatId],
  );
  const load = useCallback(
    (conversation: ChatConversation, afterSeq: number) => {
      const known = seen.current.get(conversation.clearTurnId)?.status;
      if (known === 'loading' || known === 'loaded') return;
      put(conversation.clearTurnId, { status: 'loading' });
      allTurns(calls, chatId, conversation.clearSeq, afterSeq).then(
        (turns) => put(conversation.clearTurnId, { status: 'loaded', turns }),
        (error: unknown) => put(conversation.clearTurnId, { status: 'failed', error }),
      );
    },
    [calls, chatId, put],
  );
  return { loaded, load };
}
