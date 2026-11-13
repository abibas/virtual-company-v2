import { type Credential, diffFields, type OwnedDb, owned, type SlackConnection, tenant } from '@mwc/db';
import { SLACK_INBOUND_PER_HOUR, type SlackPerson } from '@mwc/shared/credentials';
import { slackInboundRepo as repo } from '../../../repo/slack-inbound.ts';
import type { SlackInboundChange, SlackInboundView } from '../../../schemas/slack-inbound.ts';
import { NO_APP_TOKEN, sealAppToken } from './app-token.ts';
import { type InboundDeps, ownerCompanies } from './context.ts';
import { HOUR_MS } from './handle.ts';
import { peopleOf } from './notice.ts';

/**
 * A Slack bot sign-in's inbound settings (2026-11-13, docs/subscriptions.md "Slack: receiving messages"), always as its
 * owner: shown with the agents its default may be (those whose profile's Slack part uses this sign-in, in the owner's
 * companies) and, before they were ever saved, the defaults: only listed people, the owner's own Slack person first
 * when one of their user tokens (`slack_user_token`, of the same workspace) says who they are. A change is checked
 * (receiving needs the app token; the default agent one of the choices), saved with the app token sealed, audited
 * without it, and the connection synced at once.
 */

export type Refusal = {
  readonly ok: false;
  readonly status: 404 | 422;
  readonly code: string;
  readonly message: string;
};
const refuse = (status: 404 | 422, code: string, message: string): Refusal => ({
  ok: false,
  status,
  code,
  message,
});

export const SIGN_IN_NOT_FOUND = refuse(404, 'credential_not_found', 'No such sign-in of yours');
export const NOT_A_BOT = refuse(
  422,
  'not_a_slack_bot',
  'Receiving messages needs a Slack bot sign-in (xoxb-)',
);
export const SIGN_IN_REVOKED = refuse(
  422,
  'credential_revoked',
  'This sign-in was revoked: add the token again',
);
export const APP_TOKEN_MISSING = refuse(
  422,
  'app_token_missing',
  'Receiving messages needs the app-level token (xapp-) first',
);
export const AGENT_NOT_ELIGIBLE = refuse(
  422,
  'agent_not_eligible',
  "The default agent must be one of yours whose profile's Slack part uses this sign-in",
);

export interface SettingsDeps extends InboundDeps {
  /** The server's connections, when it keeps them (its background work is on). */
  readonly receiving?: { sync(credentialId: string, ownerUserId: string): Promise<void> } | undefined;
}

/** The owner's bot sign-in, or why not. */
export async function botSignIn(o: OwnedDb, credentialId: string): Promise<Credential | Refusal> {
  const sign = await repo.signInOf(o, credentialId);
  if (sign === undefined || !sign.kind.startsWith('slack_')) return SIGN_IN_NOT_FOUND;
  if (sign.kind !== 'slack_bot_token') return NOT_A_BOT;
  return sign.status === 'revoked' ? SIGN_IN_REVOKED : sign;
}

/** The owner's own Slack person in the bot's workspace, from their user tokens' account details. */
async function ownPeople(o: OwnedDb, bot: Credential): Promise<SlackPerson[]> {
  const team = bot.accountMeta.teamId;
  const people = new Map<string, SlackPerson>();
  for (const token of await repo.userTokensOf(o)) {
    const { teamId, userId, user } = token.accountMeta;
    if (teamId !== team || typeof userId !== 'string' || typeof user !== 'string') continue;
    people.set(userId, { id: userId, name: user, image: null });
  }
  return [...people.values()];
}

/** The agents whose profile's Slack part uses this sign-in, in the owner's companies. */
async function choices(deps: InboundDeps, o: OwnedDb, credentialId: string) {
  const profiles = await repo.profilesUsing(o, credentialId);
  if (profiles.length === 0) return [];
  const agents: SlackInboundView['agents'][number][] = [];
  for (const company of await ownerCompanies(deps.db, o.userId)) {
    for (const agent of await repo.liveAgents(await tenant(deps.db, company.companyId), profiles)) {
      agents.push({
        companyId: company.companyId,
        companyName: company.name,
        companySlug: company.slug,
        agentId: agent.id,
        agentName: agent.name,
        agentSlug: agent.slug,
      });
    }
  }
  return agents;
}

/** The settings as the API shows them (see above). */
async function viewOf(deps: SettingsDeps, o: OwnedDb, bot: Credential, row: SlackConnection | undefined) {
  const since = new Date(deps.clock().getTime() - HOUR_MS);
  const view: SlackInboundView = {
    credentialId: bot.id,
    appToken: row?.appCiphertext != null,
    inbound: row?.inbound ?? false,
    wake: row?.wake ?? 'listed',
    people: row === undefined ? await ownPeople(o, bot) : peopleOf(row),
    defaultAgent:
      row?.defaultCompanyId != null && row.defaultAgentId != null
        ? { companyId: row.defaultCompanyId, agentId: row.defaultAgentId }
        : null,
    maxPerHour: row?.maxPerHour ?? SLACK_INBOUND_PER_HOUR.default,
    lastHour: await deps.credentials.usesSince(bot.id, o.userId, 'inbound', since),
    status: row?.status ?? 'off',
    statusMessage: row?.statusMessage ?? null,
    statusAt: row?.statusAt?.toISOString() ?? null,
    receiving: deps.receiving !== undefined,
    agents: await choices(deps, o, bot.id),
  };
  return view;
}

/** What the audit rows keep of the settings: no secret, only whether an app token is set. */
const audited = (
  view: Omit<SlackInboundView, 'lastHour' | 'agents' | 'status' | 'statusMessage' | 'statusAt'>,
) => ({
  appToken: view.appToken ? 'set' : null,
  inbound: view.inbound,
  wake: view.wake,
  people: view.people.map((person) => person.id),
  defaultAgent: view.defaultAgent,
  maxPerHour: view.maxPerHour,
});

/** The row's columns a change sets, its app token sealed (removing it stops receiving). */
function columnsOf(
  deps: SettingsDeps,
  owner: { credentialId: string; ownerUserId: string },
  change: SlackInboundChange,
) {
  const { appToken, defaultAgent, people, ...rest } = change;
  return {
    ...rest,
    ...(people === undefined ? {} : { people }),
    ...(defaultAgent === undefined
      ? {}
      : { defaultCompanyId: defaultAgent?.companyId ?? null, defaultAgentId: defaultAgent?.agentId ?? null }),
    ...(appToken === undefined
      ? {}
      : appToken === null
        ? { ...NO_APP_TOKEN, inbound: false }
        : sealAppToken(deps.keyring, owner, appToken)),
  };
}

/** The settings service on these deps. */
export function slackInboundSettings(deps: SettingsDeps) {
  return {
    async view(userId: string, credentialId: string) {
      const o = owned(deps.db, userId);
      const bot = await botSignIn(o, credentialId);
      if ('ok' in bot) return bot;
      return {
        ok: true as const,
        view: await viewOf(deps, o, bot, await repo.connectionOf(o, credentialId)),
      };
    },

    async change(
      caller: { readonly userId: string; readonly requestId: string },
      credentialId: string,
      change: SlackInboundChange,
    ) {
      const o = owned(deps.db, caller.userId);
      const bot = await botSignIn(o, credentialId);
      if ('ok' in bot) return bot;
      const stored = await repo.connectionOf(o, credentialId);
      const before = await viewOf(deps, o, bot, stored);
      const hasToken = change.appToken === undefined ? before.appToken : change.appToken !== null;
      const receives = change.appToken === null ? false : (change.inbound ?? before.inbound);
      if (receives && !hasToken) return APP_TOKEN_MISSING;
      const agent = change.defaultAgent;
      const eligible = (one: SlackInboundView['agents'][number]) =>
        one.companyId === agent?.companyId && one.agentId === agent.agentId;
      if (agent != null && !before.agents.some(eligible)) return AGENT_NOT_ELIGIBLE;
      const owner = { credentialId, ownerUserId: caller.userId };
      const created = stored === undefined;
      const initial = created ? { people: before.people } : {};
      const row = await repo.saveConnection(o, credentialId, {
        ...initial,
        ...columnsOf(deps, owner, change),
      });
      const after = await viewOf(deps, o, bot, row);
      await o.audit({
        actorKind: 'user',
        requestId: caller.requestId,
        entityType: 'slack_connection',
        entityId: credentialId,
        action: created ? 'create' : 'update',
        changes: diffFields(created ? null : audited(before), audited(after)),
      });
      await deps.receiving?.sync(credentialId, caller.userId);
      const synced = await repo.connectionOf(o, credentialId);
      return { ok: true as const, view: synced === undefined ? after : { ...after, ...statusOf(synced) } };
    },
  };
}

/** A row's status as the view shows it. */
const statusOf = (row: SlackConnection) => ({
  status: row.status,
  statusMessage: row.statusMessage,
  statusAt: row.statusAt?.toISOString() ?? null,
});
