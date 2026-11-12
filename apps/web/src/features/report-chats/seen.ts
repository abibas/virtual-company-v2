import { useEffect, useSyncExternalStore } from 'react';
import type { ChatTurnWithEvents } from '../../api/types.ts';

/**
 * What this browser has seen of the chats with your direct reports: per chat, the end of the latest reply shown to you
 * (in the rail or on the chat page), and when this browser first looked (`since`), so the first visit does not mark every
 * old reply new. Kept in this browser only (`localStorage`), shared between its tabs; a blocked storage keeps it for the
 * page. Also the agent whose chat the rail had open last, per company.
 */

const SEEN = 'mwc.railChats.seen';
const SINCE = 'mwc.railChats.since';
const AGENT = 'mwc.railChats.agent';
/** At most this many chats are remembered; the oldest marks go first. */
const KEEP = 300;

type Marks = Record<string, string>;

const listeners = new Set<() => void>();
let marks: Marks | undefined;
let since: number | undefined;
let version = 0;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked (a private window): it holds for this page only.
  }
}

function loadMarks(): Marks {
  if (marks) return marks;
  try {
    const parsed: unknown = JSON.parse(read(SEEN) ?? '{}');
    marks = parsed && typeof parsed === 'object' ? (parsed as Marks) : {};
  } catch {
    marks = {};
  }
  return marks;
}

function sinceAt(): number {
  if (since !== undefined) return since;
  const stored = Date.parse(read(SINCE) ?? '');
  since = Number.isNaN(stored) ? Date.now() : stored;
  if (Number.isNaN(stored)) write(SINCE, new Date(since).toISOString());
  return since;
}

function changed(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== SEEN) return;
    marks = undefined;
    changed();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** Re-renders when a mark changes, here or in another tab. */
export function useSeenMarks(): number {
  return useSyncExternalStore(subscribe, () => version);
}

/** Since when the chat's replies count as seen: its mark, or this browser's first look. */
export function seenSince(chatId: string): number {
  const mark = Date.parse(loadMarks()[chatId] ?? '');
  return Number.isNaN(mark) ? sinceAt() : Math.max(mark, sinceAt());
}

/** Marks the chat's replies seen up to `at` (a reply's end, as the server dates it); never moves a mark back. */
export function markSeen(chatId: string, at: string): void {
  const all = loadMarks();
  const before = Date.parse(all[chatId] ?? '');
  if (!Number.isNaN(before) && before >= Date.parse(at)) return;
  const kept = Object.entries({ ...all, [chatId]: at })
    .sort(([, a], [, b]) => Date.parse(b) - Date.parse(a))
    .slice(0, KEEP);
  marks = Object.fromEntries(kept);
  write(SEEN, JSON.stringify(marks));
  changed();
}

/** The end of the latest reply among these turns (a message turn that is done), as the server's `replyAt` dates it. */
export function latestReplyAt(turns: readonly ChatTurnWithEvents[]): string | undefined {
  return turns.findLast((turn) => turn.kind === 'message' && turn.status === 'done' && turn.endedAt !== null)
    ?.endedAt as string | undefined;
}

/** Marks the shown chat's latest reply seen as it arrives. */
export function useMarkSeen(chatId: string | undefined, turns: readonly ChatTurnWithEvents[]): void {
  const reply = latestReplyAt(turns);
  useEffect(() => {
    if (chatId && reply) markSeen(chatId, reply);
  }, [chatId, reply]);
}

/** The agent whose chat the rail had open last in this company, in this browser. */
export const lastAgent = (companyId: string): string | null => read(`${AGENT}.${companyId}`);

export const rememberAgent = (companyId: string, agentId: string): void =>
  write(`${AGENT}.${companyId}`, agentId);
