/**
 * Chats with an agent (S5.1b, docs/harness.md "How a turn runs"): the limits the API, the database and the web share
 * (an agent's questions' too, S5.2), the order of a chat's queue (S5.2 step 6), and the id of a chat event on the chat's stream (`GET …/chats/{chatId}/stream`,
 * Server-Sent Events), which the web sends back as `Last-Event-ID` to get what it missed.
 */

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
