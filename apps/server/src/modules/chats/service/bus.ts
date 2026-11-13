import type { ChatStreamEvent, ChatTurnView } from '../schemas.ts';

/**
 * What a chat's stream listeners hear (S5.1b): a turn that started or changed status, each event stored, and a waiting
 * message that went (S5.2 step 6: discarded, or taken into the running turn). Memory only, in this server process: a
 * listener that missed something reads it back from the database (`Last-Event-ID`, or the chat's detail). Watchers
 * (2026-11-13, the chats' activity) hear every chat's messages, and a chat that was made or changed (`changed`: begun,
 * renamed, archived), which no chat's own listener hears.
 */

export type ChatMessage =
  | { readonly kind: 'turn'; readonly turn: ChatTurnView }
  | { readonly kind: 'event'; readonly event: ChatStreamEvent }
  | { readonly kind: 'removed'; readonly turnId: string };

/** What a watcher hears: a chat's message, or that the chat itself was made or changed. */
export type ChatActivity = ChatMessage | { readonly kind: 'chat' };

export type ChatListener = (message: ChatMessage) => void;
export type ChatWatcher = (chatId: string, activity: ChatActivity) => void;

/** Calls each one; one that throws does not stop the others (a closed stream is its own failure). */
function tell<L>(all: Iterable<L>, call: (listener: L) => void): void {
  for (const listener of [...all]) {
    try {
      call(listener);
    } catch {
      // A listener's own failure (a closed stream) is its own; the others still hear it.
    }
  }
}

export function chatBus() {
  const listeners = new Map<string, Set<ChatListener>>();
  const watchers = new Set<ChatWatcher>();
  return {
    /** Listens to a chat; returns the unsubscribe. */
    subscribe(chatId: string, listener: ChatListener): () => void {
      const own = listeners.get(chatId) ?? new Set<ChatListener>();
      listeners.set(chatId, own.add(listener));
      return () => {
        own.delete(listener);
        if (own.size === 0 && listeners.get(chatId) === own) listeners.delete(chatId);
      };
    },
    /** Hears every chat's messages and changes; returns the unsubscribe. */
    watch(watcher: ChatWatcher): () => void {
      watchers.add(watcher);
      return () => {
        watchers.delete(watcher);
      };
    },
    /** Tells every listener of the chat, then every watcher. */
    publish(chatId: string, message: ChatMessage): void {
      tell(listeners.get(chatId) ?? [], (listener) => listener(message));
      tell(watchers, (watcher) => watcher(chatId, message));
    },
    /** Tells the watchers that the chat was made or changed (begun, renamed, archived). */
    changed(chatId: string): void {
      tell(watchers, (watcher) => watcher(chatId, { kind: 'chat' }));
    },
    /** How many listeners a chat has (tests). */
    count: (chatId: string): number => listeners.get(chatId)?.size ?? 0,
    /** How many watchers there are (tests). */
    watching: (): number => watchers.size,
  };
}

export type ChatBus = ReturnType<typeof chatBus>;
