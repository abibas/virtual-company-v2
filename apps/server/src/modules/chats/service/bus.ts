import type { ChatStreamEvent, ChatTurnView } from '../schemas.ts';

/**
 * What a chat's stream listeners hear (S5.1b): a turn that started or changed status, and each event stored. Memory
 * only, in this server process: a listener that missed something reads it back from the database (`Last-Event-ID`).
 */

export type ChatMessage =
  | { readonly kind: 'turn'; readonly turn: ChatTurnView }
  | { readonly kind: 'event'; readonly event: ChatStreamEvent };

export type ChatListener = (message: ChatMessage) => void;

export function chatBus() {
  const listeners = new Map<string, Set<ChatListener>>();
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
    /** Tells every listener of the chat; one that throws does not stop the others. */
    publish(chatId: string, message: ChatMessage): void {
      for (const listener of [...(listeners.get(chatId) ?? [])]) {
        try {
          listener(message);
        } catch {
          // A listener's own failure (a closed stream) is its own; the others still hear it.
        }
      }
    },
    /** How many listeners a chat has (tests). */
    count: (chatId: string): number => listeners.get(chatId)?.size ?? 0,
  };
}

export type ChatBus = ReturnType<typeof chatBus>;
