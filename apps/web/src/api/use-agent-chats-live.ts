import { useCallback, useMemo, useState } from 'react';
import { type ChatActivity, useChatActivity } from './chat-activity.ts';
import { chatOrder } from './chat-order.ts';
import { useAgentChats } from './chats.ts';
import type { ChatListItem, ChatTurn } from './types.ts';
import type { Loaded } from './use-load.ts';

/**
 * An agent's chats, live (2026-11-13, docs/harness.md "Live chat lists"): the list as loaded, with every chat the
 * company's chats' activity tells for this agent put in place (a new one, a Slack conversation's; an archived one
 * gone), each with its people and its latest turn (2026-11-14: in the list and in the activity alike), for its dot and
 * its place: the chats with a live turn first, then by their latest turn (`chatOrder`). A fresh load (after a change
 * the page made, or the activity's stream opening again) replaces what the activity added.
 */

export interface LiveAgentChats {
  readonly chats: Loaded<{ readonly chats: readonly ChatListItem[] }>;
  /** The latest turn of each listed chat. */
  readonly lastTurns: ReadonlyMap<string, ChatTurn | null>;
}

/** The loaded chats with the told ones in place, the archived ones left out, in the list's order. */
export function withActivity(
  loaded: readonly ChatListItem[],
  told: ReadonlyMap<string, ChatListItem>,
): ChatListItem[] {
  const byId = new Map(loaded.map((chat) => [chat.id, chat]));
  for (const chat of told.values()) byId.set(chat.id, chat);
  return [...byId.values()].filter((chat) => chat.archivedAt === null).sort(chatOrder);
}

interface Told {
  /** The load the told chats go with: a fresh one starts them anew. */
  readonly base: unknown;
  readonly chats: ReadonlyMap<string, ChatListItem>;
}

export function useAgentChatsLive(companyId: string, agentId: string, readsChats: boolean): LiveAgentChats {
  const loaded = useAgentChats(companyId, agentId);
  const base = loaded.data;
  const [told, setTold] = useState<Told>({ base, chats: new Map() });
  const { reload } = loaded;
  const chat = useCallback(
    ({ chat }: ChatActivity) => {
      if (chat.agentId !== agentId || chat.task !== null) return;
      setTold((t) => ({ base, chats: new Map(t.base === base ? t.chats : []).set(chat.id, chat) }));
    },
    [agentId, base],
  );
  useChatActivity(companyId, readsChats, { chat, opened: reload });
  const current = told.base === base ? told.chats : undefined;
  const chats = useMemo(
    () => (base === undefined ? base : { chats: withActivity(base.chats, current ?? new Map()) }),
    [base, current],
  );
  const lastTurns = useMemo(
    () => new Map((chats?.chats ?? []).map((one) => [one.id, one.lastTurn] as const)),
    [chats],
  );
  return { chats: { ...loaded, data: chats }, lastTurns };
}
