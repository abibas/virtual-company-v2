import { useEffect, useRef } from 'react';
import type { Api } from './client.ts';
import { useApi } from './context.ts';
import { readEventStream } from './event-stream.ts';
import type { Chat, ChatTurn } from './types.ts';

/**
 * The company's chats, live (2026-11-13, `GET …/chat-activity`, docs/harness.md "Live chat lists"): one connection per
 * company in this page, shared by every list that listens (an agent's chat list, the rail's chats), read with the
 * client's Bearer header like a chat's own stream. Each `chat` message is a chat as it is now with its latest turn. A
 * dropped stream comes back after a wait (1 s, doubled up to 15 s); nothing is replayed, so each open (the first one
 * too: a change between a list's load and the open) tells the listeners to read their lists again. A refusal (a viewer,
 * a membership gone) stops trying.
 */

export interface ChatActivity {
  readonly chat: Chat;
  readonly lastTurn: ChatTurn | null;
}

export interface ChatActivityListener {
  /** A chat as it is now, with its latest turn. */
  chat(activity: ChatActivity): void;
  /** The stream opened (again): what came meanwhile is not replayed, read the list again. */
  opened(): void;
}

interface Connection {
  readonly listeners: Set<ChatActivityListener>;
  stop(): void;
}

const connections = new Map<string, Connection>();

const backoff = (failures: number) => Math.min(15_000, 1000 * 2 ** Math.min(failures, 4));

function parsed(data: string): ChatActivity | undefined {
  try {
    return JSON.parse(data) as ChatActivity;
  } catch {
    return undefined;
  }
}

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

/** Opens the company's activity and keeps it open, telling `listeners`, until `stop`. */
function connect(api: Api, companyId: string): Connection {
  const listeners = new Set<ChatActivityListener>();
  const controller = new AbortController();
  const { signal } = controller;
  const tell = (call: (listener: ChatActivityListener) => void) => {
    for (const listener of [...listeners]) call(listener);
  };
  void (async () => {
    let failures = 0;
    while (!signal.aborted) {
      try {
        const res = await api.api.companies[':companyId']['chat-activity'].$get(
          { param: { companyId } },
          { init: { signal } },
        );
        if (res.status === 403 || res.status === 404) return;
        if (!res.ok || res.body === null) throw new Error(`chat activity answered ${res.status}`);
        failures = 0;
        tell((listener) => listener.opened());
        await readEventStream(res.body, (message) => {
          const activity = message.event === 'chat' ? parsed(message.data) : undefined;
          if (activity) tell((listener) => listener.chat(activity));
        });
      } catch {
        // Dropped, refused or aborted: tried again below unless stopped.
      }
      await pause(backoff(failures), signal);
      failures += 1;
    }
  })();
  return { listeners, stop: () => controller.abort() };
}

/** Listens to the company's chats' activity while `enabled` (members and above read chats). */
export function useChatActivity(companyId: string, enabled: boolean, listener: ChatActivityListener): void {
  const api = useApi();
  const current = useRef(listener);
  current.current = listener;
  useEffect(() => {
    if (!enabled) return;
    const connection = connections.get(companyId) ?? connect(api, companyId);
    connections.set(companyId, connection);
    const mine: ChatActivityListener = {
      chat: (activity) => current.current.chat(activity),
      opened: () => current.current.opened(),
    };
    connection.listeners.add(mine);
    return () => {
      connection.listeners.delete(mine);
      if (connection.listeners.size > 0) return;
      connection.stop();
      if (connections.get(companyId) === connection) connections.delete(companyId);
    };
  }, [api, companyId, enabled]);
}
