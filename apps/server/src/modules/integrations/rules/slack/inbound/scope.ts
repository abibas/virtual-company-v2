import type { SlackInboundMessage } from '@mwc/tools-core';
import { isThreadReply } from './event.ts';

/**
 * Which conversation a Slack message belongs to (2026-11-14, Ihor: "start NEW whenever this Airia Bro is tagged in
 * different groups, or inside the message thread with him… UNLESS the user is pointing to the message / replying to the
 * message"; docs/subscriptions.md "One conversation per thread"): a reply in a thread goes on in that thread's; a message
 * in no thread starts a new one, unless it points to a message of the same channel or DM (a link to it in its text, or
 * Slack's Share message), whose thread's conversation it then joins. Messages are found by their links
 * (`<workspace>/archives/<channel>/p<ts without the dot>`, `?thread_ts=` for a reply in a thread). Pure.
 */

/**
 * How full a Slack conversation gets before its next message compacts it first: 60% of the model's window, by the last
 * turn's reading (2026-11-14; a constant for now, not a setting of the card).
 */
export const SLACK_COMPACT_AT = 0.6;

/** A Slack message read from its link: the workspace's host, the channel, the message and its thread's first message. */
export interface SlackAddress {
  readonly host: string;
  readonly channel: string;
  readonly ts: string;
  readonly root: string;
}

const LINK = /^https:\/\/([^/\s?#]+)\/archives\/([CDG][A-Z0-9]{2,39})\/p(\d{10})(\d{6})(?:\?([^\s#]*))?$/;
const TS = /^\d{10}\.\d{6}$/;

/** The message a link names; undefined for any other address. */
export function addressOf(link: string): SlackAddress | undefined {
  const match = LINK.exec(link.trim().replace(/&amp;/g, '&'));
  if (match === null) return undefined;
  const [, host = '', channel = '', seconds = '', micros = '', query = ''] = match;
  const ts = `${seconds}.${micros}`;
  const thread = new URLSearchParams(query).get('thread_ts');
  return { host: host.toLowerCase(), channel, ts, root: thread !== null && TS.test(thread) ? thread : ts };
}

/** The workspace's host from its address (`https://airia.slack.com/` → `airia.slack.com`); null when unknown. */
function hostOf(workspace: string | null): string | null {
  if (workspace === null) return null;
  try {
    return new URL(workspace).host.toLowerCase();
  } catch {
    return null;
  }
}

/** The addresses a text links to as Slack writes them (`<https://…>`, `<https://…|label>`). */
const linksIn = (text: string) =>
  [...text.matchAll(/<(https:\/\/[^|>\s]+)(?:\|[^>]*)?>/g)].map((match) => match[1] as string);

/**
 * The thread a message in no thread points to: the first message it links or shares in the same channel or DM (and
 * workspace, when its address is known); undefined for a reply in a thread, or one pointing nowhere or elsewhere.
 */
export function pointedRoot(
  message: Pick<SlackInboundMessage, 'channel' | 'ts' | 'threadTs' | 'text' | 'shared'>,
  workspace: string | null,
): string | undefined {
  if (isThreadReply(message)) return undefined;
  const host = hostOf(workspace);
  for (const link of [...linksIn(message.text), ...(message.shared ?? [])]) {
    const to = addressOf(link);
    if (to === undefined || to.channel !== message.channel || to.root === message.ts) continue;
    if (host === null || to.host === host) return to.root;
  }
  return undefined;
}

/**
 * The thread whose conversation the message joins: a reply's thread, or the one it points to; null when it starts a new
 * one (its own thread).
 */
export const joinedRoot = (
  message: Pick<SlackInboundMessage, 'channel' | 'ts' | 'threadTs' | 'text' | 'shared'>,
  workspace: string | null,
): string | null =>
  isThreadReply(message) ? (message.threadTs as string) : (pointedRoot(message, workspace) ?? null);

/** Where a turn's answer goes, from the link of the message it answers: that message's thread; undefined without one. */
export function answerPlace(
  link: string | null | undefined,
): { readonly channel: string; readonly threadTs: string } | undefined {
  const to = link === null || link === undefined ? undefined : addressOf(link);
  return to && { channel: to.channel, threadTs: to.root };
}
