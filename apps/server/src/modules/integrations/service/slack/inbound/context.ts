import { type DbHandle, tenant } from '@mwc/db';
import { slackAllows } from '@mwc/shared/credentials';
import type { SlackApi, SlackSignIn } from '@mwc/tools-core';
import type { Logger } from 'pino';
import type { InboundChats } from '../../../../chats/index.ts';
import type { CredentialsForTools, SecretDeps } from '../../../../credentials/index.ts';
import { companiesOf } from '../../../../identity/service.ts';
import { postIcon } from '../../../rules/slack/icons.ts';
import type { SlackBot } from '../../../rules/slack/inbound/event.ts';
import { postName, stripMentions } from '../../../rules/slack/text.ts';

/**
 * What receiving Slack messages works with (2026-11-13): the store's deps, the Slack port, the tool sign-ins' side, the
 * chats' port for a message's turn; a live connection (its bot sign-in opened when it connected, its bot, the messages
 * and notices it saw lately); the owner's companies; and posting in Slack as an agent or as the bot.
 */

export interface InboundDeps extends SecretDeps {
  readonly logger: Logger;
  readonly slack: SlackApi;
  readonly credentials: CredentialsForTools;
}

export interface HandleDeps extends InboundDeps {
  readonly chats: InboundChats;
}

/** One Slack connection that receives messages, as its messages are handled. */
export interface Connection {
  readonly credentialId: string;
  readonly ownerUserId: string;
  /** The bot sign-in, opened for Socket Mode (`socket_mode`), used for its messages' reads and notices. */
  readonly signIn: SlackSignIn;
  readonly bot: SlackBot;
  /** True when this message was handled already (Slack sends a mention as two events). */
  readonly seen: (key: string) => boolean;
  /** When each notice was last posted (by its key), so each is said once an hour at most. */
  readonly notices: Map<string, number>;
}

/** The companies the owner belongs to, as `GET /api/me` lists them. */
export const ownerCompanies = (db: DbHandle, ownerUserId: string) =>
  companiesOf(db, { kind: 'user', via: 'clerk', userId: ownerUserId });

/** The tenant of one of the owner's companies; undefined when they are not in it (any more). */
export async function ownerTenant(db: DbHandle, ownerUserId: string, companyId: string) {
  const companies = await ownerCompanies(db, ownerUserId);
  return companies.some((company) => company.companyId === companyId) ? tenant(db, companyId) : undefined;
}

/** Who a post shows as: the agent's name and emoji icon on a bot with `chat:write.customize`, else the bot. */
export function postedAs(
  bot: SlackBot,
  agent: { readonly name: string; readonly iconKind: string; readonly iconEmoji: string | null } | undefined,
): { readonly username?: string; readonly iconEmoji?: string } {
  if (agent === undefined || !slackAllows('customize', 'slack_bot_token', bot.scopes)) return {};
  return { username: postName(agent.name), ...postIcon(agent) };
}

/** Posts a text in a conversation (a thread when `threadTs`), mentions of many people taken out. */
export async function postIn(
  api: SlackApi,
  signIn: SlackSignIn,
  where: { readonly channel: string; readonly threadTs: string | null },
  text: string,
  shown: ReturnType<typeof postedAs> = {},
) {
  const { text: plain } = stripMentions(text);
  return api.postMessage(signIn, {
    channel: where.channel,
    text: plain,
    threadTs: where.threadTs ?? undefined,
    ...shown,
  });
}
