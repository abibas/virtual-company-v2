import type { ChatTurn } from '@mwc/db';
import { storedSender, type TurnSender } from '@mwc/shared/chats';

/**
 * Who a turn Most Wanted queued speaks for (2026-11-13, docs/harness.md "Live chat lists"), pure. Since 2026-11-14
 * (docs/subscriptions.md "Contacts") a Slack message's turn stores its sender (their Slack id, name and avatar, the
 * message's link), its contact and the message as the reader sees it (`chat_turns.sender`, `contact_id`,
 * `visible_text`). A turn from before only has its prompt, which begins with the header line "Slack message from <name>
 * in <place> (<link>). Your final reply is posted …": its sender's name and link are read from it, and the visible text
 * is what follows the header. Any other turn names nobody here (a person's own is its writer's, a wake-up Most Wanted's).
 */

/** The person a Slack message's turn came from, as the turn's view names them. */
export interface TurnSenderView {
  readonly name: string;
  readonly via: 'slack';
  /** Their Slack id; null for a turn from before 2026-11-14. */
  readonly userId: string | null;
  readonly avatarUrl: string | null;
  /** The message in Slack. */
  readonly link: string | null;
  /** Their contact; null for a turn from before contacts. */
  readonly contactId: string | null;
}

/** What a turn Most Wanted queues for a message from outside stores of it. */
export interface TurnFrom {
  readonly sender: TurnSender;
  /** The message as the reader sees it, without the prompt's header. */
  readonly visibleText: string;
  readonly contactId: string | null;
}

/** The columns a turn is written with for its message from outside (none: nulls). */
export const fromColumns = (from: TurnFrom | undefined) => ({
  sender: from?.sender ?? null,
  visibleText: from?.visibleText ?? null,
  contactId: from?.contactId ?? null,
});

/** The header of a Slack message's prompt; the place never holds " in ", so the name is everything before it. */
const SLACK_HEADER =
  /^Slack message from (.+) in (?:#\S+|a DM with you|a group DM)(?: \(([^)]*)\))?\. Your final reply is posted (?:in that thread|there) under your name\.$/;

type Prompted = Pick<ChatTurn, 'system' | 'kind' | 'prompt'>;

/** A turn from before 2026-11-14 read from its prompt's header: the name, the link and the text after it. */
function fromHeader(turn: Prompted) {
  if (!turn.system || turn.kind !== 'message') return undefined;
  const [first = '', ...rest] = turn.prompt.split('\n');
  const match = SLACK_HEADER.exec(first);
  const name = match?.[1]?.trim();
  if (!match || !name) return undefined;
  return { name, link: match[2] ?? null, text: rest.join('\n').replace(/^\n/, '') };
}

/** The Slack person a turn Most Wanted queued came from; null for any other turn. */
export function senderOf(turn: Prompted & Pick<ChatTurn, 'sender' | 'contactId'>): TurnSenderView | null {
  const stored = turn.system ? storedSender(turn.sender) : null;
  if (stored !== null) {
    const { name, via, userId, avatarUrl, link } = stored;
    return { name, via, userId, avatarUrl, link, contactId: turn.contactId };
  }
  const header = fromHeader(turn);
  if (header === undefined) return null;
  return {
    name: header.name,
    via: 'slack',
    userId: null,
    avatarUrl: null,
    link: header.link,
    contactId: null,
  };
}

/** What the reader sees of a message from outside: its stored text, else the prompt after its header; else null. */
export function visibleTextOf(turn: Prompted & Pick<ChatTurn, 'visibleText'>): string | null {
  if (turn.visibleText !== null) return turn.visibleText;
  return fromHeader(turn)?.text ?? null;
}
