/**
 * Chats with an agent (S5.1b, docs/harness.md "How a turn runs"): the limits the API, the database and the web share
 * (an agent's questions' too, S5.2), the order of a chat's queue (S5.2 step 6), and the id of a chat event on the chat's stream (`GET …/chats/{chatId}/stream`,
 * Server-Sent Events), which the web sends back as `Last-Event-ID` to get what it missed, and how far each harness
 * branches a conversation.
 */

import type { Harness } from './enums.ts';

/** A chat's title: the first prompt's start, at most 80 characters. */
export const CHAT_TITLE = { min: 1, max: 80 } as const;

/** One prompt: 1 to 20 000 characters. */
export const CHAT_PROMPT = { min: 1, max: 20_000 } as const;

/**
 * How much of a chat its detail holds (`GET …/chats/{chatId}`): the latest 30 turns of its current conversation; the
 * older ones page in from `GET …/chats/{chatId}/turns`, 20 at a time by default and at most 50.
 */
export const CHAT_WINDOW = 30;
export const CHAT_PAGE = { min: 1, default: 20, max: 50 } as const;

/** The most messages a chat keeps waiting for its running turn (S5.2 step 6). */
export const CHAT_QUEUE_MAX = 10;

/** What orders a chat's queue: how the message was sent, and its number in the chat. */
export interface QueuedPlace {
  readonly delivery: 'now' | 'after' | 'interrupt' | null;
  readonly seq: number;
}

/**
 * The order a chat's queued turns start in (docs/harness.md, "Delivery while a turn runs"): a message sent Now that the
 * running turn did not take, and one that interrupts, before the ones sent for after the turn; each group oldest first.
 */
export function queueOrder(a: QueuedPlace, b: QueuedPlace): number {
  const first = (place: QueuedPlace) => (place.delivery === 'after' ? 1 : 0);
  return first(a) - first(b) || a.seq - b.seq;
}

/** The runner's question tool (S5.2 step 4, `harness/questions.ts`) and its MCP server's name. */
export const ASK_TOOL = 'ask_user_question';
export const ASK_SERVER = 'mwc';
/**
 * How each harness names a call of it: Claude Code's `mcp__<server>__<tool>` (what `--allowedTools` takes), Codex's
 * `mcp:<server>/<tool>` (its parser's).
 */
export const ASK_TOOL_CALLS = [`mcp__${ASK_SERVER}__${ASK_TOOL}`, `mcp:${ASK_SERVER}/${ASK_TOOL}`] as const;

/** A call's limits: 1–4 questions of at most 500 characters, a header of 12, 2–8 options of 60 (a description 200). */
export const ASK_LIMITS = {
  questions: { min: 1, max: 4 },
  question: 500,
  header: 12,
  options: { min: 2, max: 8 },
  label: 60,
  description: 200,
  /** The person's own answer in the "Other" box. */
  other: 2000,
} as const;

/** How often the stream sends a comment line, so proxies keep it open and the web sees it is alive. */
export const CHAT_STREAM_HEARTBEAT_MS = 20_000;

/** An event's place in its chat: the turn's number in the chat and the event's in the turn. */
export interface ChatEventPosition {
  readonly turnSeq: number;
  readonly eventSeq: number;
}

/** The stream's `id:` of an event: `<turn seq>.<event seq>` (`3.17`). */
export const chatEventId = (position: ChatEventPosition): string =>
  `${position.turnSeq}.${position.eventSeq}`;

const EVENT_ID = /^([1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;

/** Reads a `Last-Event-ID`; undefined for anything that is not one. */
export function parseChatEventId(text: string | undefined): ChatEventPosition | undefined {
  const match = EVENT_ID.exec(text?.trim() ?? '');
  if (!match) return undefined;
  return { turnSeq: Number(match[1]), eventSeq: Number(match[2]) };
}

/** True when `a` comes after `b` in the chat. */
export const isAfter = (a: ChatEventPosition, b: ChatEventPosition): boolean =>
  a.turnSeq > b.turnSeq || (a.turnSeq === b.turnSeq && a.eventSeq > b.eventSeq);

/**
 * How far a harness forks a conversation for a branch (docs/harness.md "Branching"): from any reply (Claude Code:
 * `--fork-session`, cut with `--resume-session-at`), from the latest reply only (Codex: `codex exec fork` copies a
 * whole thread), or not at all, and why. The server's rules and the web's Branch action both read it.
 */
export type BranchSupport = 'any' | 'latest' | { readonly unsupported: string };

export const BRANCH_SUPPORT: Readonly<Record<Harness, BranchSupport>> = {
  claude_code: 'any',
  codex: 'latest',
};

/**
 * The error of a turn whose machine's runner went away (S5.4): `machine_disconnected`, and since 2026-11-12 the words
 * the server writes after it, naming the machine and how long ("machine_disconnected: Airia devbox was unreachable for
 * 30 minutes: the turn stopped."). The web and a blocked task show the words; a runner that comes back later with a
 * turn ended so (or `server_restarted`) may still get it back (docs/harness.md "Surviving restarts").
 */
export const MACHINE_DISCONNECTED = 'machine_disconnected';
const DISCONNECTED_PREFIX = `${MACHINE_DISCONNECTED}: `;

/** `machine_disconnected: <words>`. */
export const disconnectedError = (words: string): string => `${DISCONNECTED_PREFIX}${words}`;

/** The words of `machine_disconnected: <words>`; undefined for any other error (the bare code too). */
export const disconnectedWords = (error: string): string | undefined =>
  error.startsWith(DISCONNECTED_PREFIX) ? error.slice(DISCONNECTED_PREFIX.length) : undefined;

/** True for the error of a turn whose machine's runner went away, bare (before 2026-11-12) or with its words. */
export const isDisconnected = (error: string | null | undefined): boolean =>
  error === MACHINE_DISCONNECTED || (error ?? '').startsWith(DISCONNECTED_PREFIX);

/** A length of time as people read it: "under a second", "45 seconds", "1 minute", "30 minutes", "2 hours 5 minutes". */
export function durationWords(ms: number): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (ms < 1000) return 'under a second';
  if (ms < 60_000) return plural(Math.floor(ms / 1000), 'second');
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return plural(minutes, 'minute');
  const rest = minutes % 60;
  return rest === 0
    ? plural(minutes / 60, 'hour')
    : `${plural(Math.floor(minutes / 60), 'hour')} ${plural(rest, 'minute')}`;
}
