/**
 * Chats with an agent (S5.1b, docs/harness.md "How a turn runs"): the limits the API, the database and the web share,
 * and the id of a chat event on the chat's stream (`GET …/chats/{chatId}/stream`, Server-Sent Events), which the web
 * sends back as `Last-Event-ID` to get what it missed.
 */

/** A chat's title: the first prompt's start, at most 80 characters. */
export const CHAT_TITLE = { min: 1, max: 80 } as const;

/** One prompt: 1 to 20 000 characters. */
export const CHAT_PROMPT = { min: 1, max: 20_000 } as const;

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
