import type { SlackInboundMessage, SlackMessage } from '@mwc/tools-core';
import { renderSlackText } from './text.ts';
import { oneLine } from './words.ts';

/**
 * A Slack thread's earlier messages in a reply's prompt (2026-11-14, docs/subscriptions.md "Thread context"; Ihor's
 * agent was asked in a thread to approve a pull request whose link was only in the thread's first message, and it got
 * the reply's text alone). The messages the agent has not seen yet: those after the start of its last successful turn
 * in that chat (all of them without one), never the new message or its own posts there, the thread's first message
 * always. Each is one line, its author by name, its markup rendered and what it shares or unfurls by address; the block
 * keeps to a budget, the oldest dropped first and the first message kept. Without the history scope its place needs, or
 * when Slack refuses, one line says so. Pure.
 */

/** About how long the block gets. */
export const THREAD_BUDGET = 8_000;
/** The longest one message's text in it. */
export const THREAD_MESSAGE_MAX = 2_000;
export const THREAD_HEAD = 'Earlier in this thread:';

/** The history scope a thread's place needs (`conversations.replies`), or both a channel may need when unknown. */
export function historyScopes(
  message: Pick<SlackInboundMessage, 'channel' | 'channelType'>,
): readonly string[] {
  const byType: Readonly<Record<string, string>> = {
    channel: 'channels:history',
    group: 'groups:history',
    im: 'im:history',
    mpim: 'mpim:history',
  };
  const known = message.channelType === null ? undefined : byType[message.channelType];
  if (known !== undefined) return [known];
  if (message.channel.startsWith('D')) return ['im:history'];
  if (message.channel.startsWith('G')) return ['groups:history', 'mpim:history'];
  return ['channels:history', 'groups:history'];
}

/** The line said instead of the block when the bot has none of the scopes the place may need. */
export const missingScopeLine = (scopes: readonly string[]) =>
  `${THREAD_HEAD} not read: the Slack app has no ${scopes.join(' or ')} scope (add it on its OAuth & Permissions ` +
  'page and reinstall it). Ask for the earlier messages if you need them.';

/** The line said instead of the block when Slack refused the read. */
export const unreadLine = (why: string) =>
  `${THREAD_HEAD} could not be read (${oneLine(why, 200)}). Ask for the earlier messages if you need them.`;

/** What the agent has seen of the thread: messages up to `seenUntil` (Slack ts seconds), and its own posts. */
export interface Seen {
  /** The start of its last successful turn there, in seconds; null when it has none (it saw nothing). */
  readonly seenUntil: number | null;
  readonly own: ReadonlySet<string>;
}

/** The thread's messages the agent has not seen, oldest first; the first message always (see above). */
export function unseenMessages(
  messages: readonly SlackMessage[],
  at: { readonly root: string; readonly ts: string },
  seen: Seen,
): SlackMessage[] {
  const now = Number(at.ts);
  return messages
    .filter((message) => {
      if (message.ts === at.root) return message.ts !== at.ts;
      const ts = Number(message.ts);
      if (!(ts < now) || seen.own.has(message.ts)) return false;
      return seen.seenUntil === null || ts >= seen.seenUntil;
    })
    .sort((a, b) => Number(a.ts) - Number(b.ts));
}

/** Who wrote a message: a person by name, a bot by the name it posted under. */
function authorOf(message: SlackMessage, names: ReadonlyMap<string, string>): string {
  if (message.user !== null) return names.get(message.user) ?? message.user;
  return message.username ?? 'a bot';
}

/** One message as a line of the block: "- Erich: Approve: https://… [shared: #7 Fix (https://…)]". */
export function threadLine(message: SlackMessage, names: ReadonlyMap<string, string>, root: string): string {
  const text = renderSlackText(message.text, names).trim();
  const shared = (message.attachments ?? []).map((attachment) => {
    const title = attachment.title === null ? '' : oneLine(attachment.title, 200);
    if (attachment.url === null) return title;
    return title === '' ? attachment.url : `${title} (${attachment.url})`;
  });
  const files = message.files.length === 0 ? '' : ` [files: ${message.files.join(', ')}]`;
  const shares = shared.length === 0 ? '' : ` [shared: ${shared.join('; ')}]`;
  const body = text.length <= THREAD_MESSAGE_MAX ? text : `${text.slice(0, THREAD_MESSAGE_MAX - 1)}…`;
  const first = message.ts === root ? ' (first message)' : '';
  return `- ${oneLine(authorOf(message, names), 80)}${first}: ${body.replace(/\n/g, '\n  ')}${shares}${files}`;
}

/** The block: its head, then the lines kept within the budget (the first message's always), oldest dropped first. */
export function threadBlock(lines: readonly string[], rootFirst: boolean): string | null {
  if (lines.length === 0) return null;
  const [root, ...rest] = rootFirst ? lines : [undefined, ...lines];
  let room = THREAD_BUDGET - THREAD_HEAD.length - (root?.length ?? 0);
  const kept: string[] = [];
  for (const line of [...rest].reverse()) {
    if (line === undefined || line.length + 1 > room) break;
    kept.unshift(line);
    room -= line.length + 1;
  }
  const dropped = rest.length - kept.length;
  const note =
    dropped === 0 ? [] : [`- (${dropped} earlier ${dropped === 1 ? 'message' : 'messages'} left out)`];
  return [THREAD_HEAD, ...(root === undefined ? [] : [root]), ...note, ...kept].join('\n');
}
