import { type Agent, owned, type SlackConnection, type TenantDb, tenant } from '@mwc/db';
import { isSlackError, type SlackInboundMessage } from '@mwc/tools-core';
import { slackInboundRepo as repo } from '../../../repo/slack-inbound.ts';
import type { InboundKind } from '../../../rules/slack/inbound/event.ts';
import { addressedAgent, afterBotMention } from '../../../rules/slack/inbound/text.ts';
import { type Connection, type InboundDeps, ownerCompanies, ownerTenant } from './context.ts';

/**
 * Which agent answers a Slack message (2026-11-13, docs/subscriptions.md "Slack: receiving messages"), in this order:
 * the agent it names right after the bot's mention (`@Bot @Developer …`, by name or slug, any case) among the owner's
 * companies' agents; for a reply in a thread, the agent that last posted there through this sign-in (its recorded
 * posts; else the thread's first message, when the bot posted it under an agent's name); else the connection's default
 * agent. A reply in a thread no agent of ours is in is not ours; a fresh mention or a DM with no default agent says so.
 * Since 2026-11-14 a message in no thread that points to a message of its channel (`rules/slack/inbound/scope.ts`) goes
 * to that thread's agent as a reply there would, else to the default agent.
 */

export type Picked =
  | { readonly t: TenantDb; readonly agent: Agent; readonly how: 'named' | 'thread' | 'default' }
  | { readonly none: 'not_ours' | 'no_default' };

/** The agent the message names first, among the agents of the owner's companies (the default agent's first). */
async function named(
  deps: InboundDeps,
  conn: Connection,
  settings: SlackConnection,
  message: SlackInboundMessage,
): Promise<Picked | undefined> {
  if (!afterBotMention(message.text, conn.bot.userId).startsWith('@')) return undefined;
  const companies = await ownerCompanies(deps.db, conn.ownerUserId);
  const first = settings.defaultCompanyId;
  companies.sort((a, b) => Number(b.companyId === first) - Number(a.companyId === first));
  for (const company of companies) {
    const t = await tenant(deps.db, company.companyId);
    const agent = addressedAgent(message.text, conn.bot.userId, await repo.liveAgents(t));
    if (agent !== undefined) return { t, agent, how: 'named' };
  }
  return undefined;
}

/** A company's agent, unless the owner left the company or the agent is archived. */
async function agentIn(deps: InboundDeps, conn: Connection, companyId: string, agentId: string) {
  const t = await ownerTenant(deps.db, conn.ownerUserId, companyId);
  const agent = t && (await repo.liveAgent(t, agentId));
  return t && agent ? { t, agent } : undefined;
}

/** The agent whose name the bot posted the thread's first message under; undefined when the bot did not post it. */
async function threadStarter(
  deps: InboundDeps,
  conn: Connection,
  channel: string,
  root: string,
): Promise<{ readonly ours: boolean; readonly name: string | null }> {
  try {
    const page = await deps.slack.replies(conn.signIn, channel, root, { limit: 1 });
    const first = page.items[0];
    const ours = first !== undefined && first.botId !== null && first.botId === conn.bot.botId;
    return { ours, name: ours ? (first?.username ?? null) : null };
  } catch (error) {
    if (!isSlackError(error)) throw error;
    return { ours: false, name: null };
  }
}

/** The agent of a thread: its last poster through this sign-in, else one whose chat it is, else its first message's. */
async function threadAgent(
  deps: InboundDeps,
  conn: Connection,
  channel: string,
  root: string,
): Promise<Picked | 'ours' | undefined> {
  const o = owned(deps.db, conn.ownerUserId);
  const post = await repo.threadPoster(o, conn.credentialId, channel, root);
  if (post !== undefined) {
    const found = await agentIn(deps, conn, post.companyId, post.agentId);
    return found === undefined ? undefined : { ...found, how: 'thread' };
  }
  for (const company of await ownerCompanies(deps.db, conn.ownerUserId)) {
    const t = await tenant(deps.db, company.companyId);
    const at = { credentialId: conn.credentialId, channelId: channel, threadTs: root };
    const chat = await repo.threadChatAt(t, at);
    const agent = chat && (await repo.liveAgent(t, chat.agentId));
    if (agent) return { t, agent, how: 'thread' };
  }
  const starter = await threadStarter(deps, conn, channel, root);
  if (!starter.ours) return undefined;
  const profiles = await repo.profilesUsing(o, conn.credentialId);
  for (const company of await ownerCompanies(deps.db, conn.ownerUserId)) {
    const t = await tenant(deps.db, company.companyId);
    const agent = (await repo.liveAgents(t, profiles)).find((one) => one.name === starter.name);
    if (agent !== undefined) return { t, agent, how: 'thread' };
  }
  return 'ours';
}

/** The connection's default agent. */
async function defaultAgent(deps: InboundDeps, conn: Connection, settings: SlackConnection): Promise<Picked> {
  const { defaultCompanyId, defaultAgentId } = settings;
  if (defaultCompanyId === null || defaultAgentId === null) return { none: 'no_default' };
  const found = await agentIn(deps, conn, defaultCompanyId, defaultAgentId);
  return found === undefined ? { none: 'no_default' } : { ...found, how: 'default' };
}

/** The agent that answers the message (see above); `joined`: the thread whose conversation it joins, if any. */
export async function pickAgent(
  deps: InboundDeps,
  conn: Connection,
  settings: SlackConnection,
  message: SlackInboundMessage,
  how: { readonly kind: InboundKind; readonly joined: string | null },
): Promise<Picked> {
  const { kind, joined } = how;
  const byName = await named(deps, conn, settings, message);
  if (byName !== undefined) return byName;
  if (joined !== null) {
    const thread = await threadAgent(deps, conn, message.channel, joined);
    if (thread !== undefined && thread !== 'ours') return thread;
    if (thread === undefined && kind === 'thread') return { none: 'not_ours' };
  }
  return defaultAgent(deps, conn, settings);
}
