import { useCallback, useMemo, useState } from 'react';
import { type ChatActivity, useChatActivity } from './chat-activity.ts';
import { useAgentChats } from './chats.ts';
import type { Chat, ChatTurn } from './types.ts';
import type { Loaded } from './use-load.ts';

/**
 * An agent's chats, live (2026-11-13, docs/harness.md "Live chat lists"): the list as loaded, with every chat the
 * company's chats' activity tells for this agent put in place (a new one, a Slack conversation's, on top; one with a
 * new turn moved up; an archived one gone), and each told chat's latest turn, for its dot. A fresh load (after a change
 * the page made, or the activity's stream opening again) replaces what the activity added; the latest turns stay.
 */

export interface LiveAgentChats {
  readonly chats: Loaded<{ readonly chats: readonly Chat[] }>;
  /** The latest turn of each chat the activity told since the page opened. */
  readonly lastTurns: ReadonlyMap<string, ChatTurn | null>;
}

/** The newest first, as the server orders them: by the last change, then by id. */
const newestFirst = (a: Chat, b: Chat) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id);

/** The loaded chats with the told ones in place, the archived ones left out, the newest first. */
export function withActivity(loaded: readonly Chat[], told: ReadonlyMap<string, Chat>): Chat[] {
  const byId = new Map(loaded.map((chat) => [chat.id, chat]));
  for (const chat of told.values()) byId.set(chat.id, chat);
  return [...byId.values()].filter((chat) => chat.archivedAt === null).sort(newestFirst);
}

interface Told {
  /** The load the told chats go with: a fresh one starts them anew. */
  readonly base: unknown;
  readonly chats: ReadonlyMap<string, Chat>;
}

export function useAgentChatsLive(companyId: string, agentId: string, readsChats: boolean): LiveAgentChats {
  const loaded = useAgentChats(companyId, agentId);
  const base = loaded.data;
  const [told, setTold] = useState<Told>({ base, chats: new Map() });
  const [lastTurns, setLastTurns] = useState<ReadonlyMap<string, ChatTurn | null>>(new Map());
  const { reload } = loaded;
  const chat = useCallback(
    ({ chat, lastTurn }: ChatActivity) => {
      if (chat.agentId !== agentId || chat.task !== null) return;
      setTold((t) => ({ base, chats: new Map(t.base === base ? t.chats : []).set(chat.id, chat) }));
      setLastTurns((turns) => new Map(turns).set(chat.id, lastTurn));
    },
    [agentId, base],
  );
  useChatActivity(companyId, readsChats, { chat, opened: reload });
  const current = told.base === base ? told.chats : undefined;
  const chats = useMemo(
    () => (base === undefined || current === undefined ? base : { chats: withActivity(base.chats, current) }),
    [base, current],
  );
  return { chats: { ...loaded, data: chats }, lastTurns };
}
