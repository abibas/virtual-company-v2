import type { ChatTurn } from '../../api/types.ts';
import { seenSince } from '../report-chats/seen.ts';

/**
 * The dots of an agent's chat list (2026-11-13, docs/harness.md "Live chat lists"), from each chat's latest turn the
 * chats' activity told: green while a turn waits or runs, blue for a turn that ended after what this browser has seen
 * of the chat (the marks the open chat and the rail keep); never on the chat open on the page.
 */

export type ChatDot = 'working' | 'unseen';

export const CHAT_DOT_WORDS: Readonly<Record<ChatDot, string>> = {
  working: 'working',
  unseen: 'new activity',
};

/** One chat's dot, from its latest turn; none for the open chat or without a turn told. */
export function chatDot(chatId: string, turn: ChatTurn | null | undefined, openId: string | undefined): ChatDot | null {
  if (chatId === openId || turn === null || turn === undefined) return null;
  if (turn.status === 'queued' || turn.status === 'running') return 'working';
  if (turn.endedAt === null) return null;
  return Date.parse(turn.endedAt) > seenSince(chatId) ? 'unseen' : null;
}

/** The dots of the chats whose latest turn was told. */
export function chatDots(
  lastTurns: ReadonlyMap<string, ChatTurn | null>,
  openId: string | undefined,
): ReadonlyMap<string, ChatDot> {
  const dots = new Map<string, ChatDot>();
  for (const [chatId, turn] of lastTurns) {
    const dot = chatDot(chatId, turn, openId);
    if (dot !== null) dots.set(chatId, dot);
  }
  return dots;
}
