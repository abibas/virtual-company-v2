import type { TenantDb } from '@mwc/db';
import { CHAT_PROMPT, TurnSender } from '@mwc/shared/chats';
import type { SlackPerson } from '@mwc/shared/credentials';
import type { SlackInboundMessage, SlackUser } from '@mwc/tools-core';
import type { TurnFrom } from '../../../../chats/index.ts';
import { seenOnSlack } from '../../../../contacts/index.ts';
import { oneLine } from '../../../rules/slack/inbound/words.ts';
import type { Connection, InboundDeps } from './context.ts';

/**
 * Who a Slack message that wakes an agent is from (2026-11-14, docs/subscriptions.md "Contacts"): their contact in the
 * agent's company, made the first time and brought up to date after (name, avatar, title, email and handle from
 * `users.info`, else the connection's listed person), and what the turn stores of them: their Slack id, name and avatar,
 * the message's link, and the message as the reader sees it (the agent still gets the prompt with its header). A bot
 * sign-in whose workspace Slack did not name makes no contact; the turn still names its sender.
 */

/** What the message's handling knows of its author. */
export interface Author {
  readonly message: SlackInboundMessage;
  /** Their name as the prompt says it. */
  readonly from: string;
  /** Slack's description of them (`users.info`), when it was read. */
  readonly described: SlackUser | undefined;
  /** The connection's listed person, when they are one. */
  readonly listed: SlackPerson | undefined;
  readonly link: string | null;
  /** The message, its mentions as names. */
  readonly text: string;
}

/** Their contact in the company (see above); undefined without the workspace's id. */
async function contactOf(deps: InboundDeps, conn: Connection, t: TenantDb, author: Author) {
  const teamId = conn.bot.teamId ?? author.message.teamId;
  if (teamId === null || teamId === '') return undefined;
  const { described, listed } = author;
  return seenOnSlack(
    t,
    {
      teamId,
      userId: author.message.user as string,
      name: author.from,
      avatarUrl: described?.image ?? listed?.image ?? null,
      title: described?.title ?? null,
      email: described?.email ?? null,
      handle: described?.name ?? null,
    },
    deps.clock(),
  );
}

/** What the woken turn stores of its message (see above), its contact made or updated first. */
export async function turnFrom(
  deps: InboundDeps,
  conn: Connection,
  t: TenantDb,
  author: Author,
): Promise<TurnFrom> {
  const contact = await contactOf(deps, conn, t, author);
  const userId = author.message.user as string;
  const name = contact?.name ?? (oneLine(author.from, 120) || userId);
  const shown = { via: 'slack', userId, name, avatarUrl: contact?.avatarUrl ?? null } as const;
  const parsed = TurnSender.safeParse({ ...shown, link: author.link });
  const sender = parsed.success ? parsed.data : { ...shown, link: null };
  const visibleText = author.text.slice(0, CHAT_PROMPT.max);
  return { sender, visibleText, contactId: contact?.id ?? null };
}
