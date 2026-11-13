import type { CredentialKind } from '../enums.ts';
import type { SlackRights } from './tool-rights.ts';

/**
 * Slack's sign-ins and what their scopes allow (S7.1e, docs/subscriptions.md "Slack"): a Slack app's bot token
 * (`xoxb-`, kind `slack_bot_token`) or user token (`xoxp-`, `slack_user_token`, which posts as that person), told apart by
 * the prefix, and the scopes each right of a profile's Slack part needs. The token's own scopes (`x-oauth-scopes`,
 * stored in its account details) cap the rights: a right whose scopes the token lacks shows as unavailable on the pages
 * and the server refuses it. Pure, so the server and the web decide alike.
 */

/** How each Slack token starts. */
export const SLACK_TOKEN_PREFIXES = { slack_bot_token: 'xoxb-', slack_user_token: 'xoxp-' } as const;
export type SlackKind = keyof typeof SLACK_TOKEN_PREFIXES;

/** True for a Slack sign-in. */
export const isSlackKind = (kind: CredentialKind): kind is SlackKind =>
  kind === 'slack_bot_token' || kind === 'slack_user_token';

/** A pasted token's kind by its prefix; undefined when it is neither a bot's nor a user's token. */
export function slackKindOf(token: string): SlackKind | undefined {
  const trimmed = token.trim();
  if (trimmed.startsWith(SLACK_TOKEN_PREFIXES.slack_bot_token)) return 'slack_bot_token';
  if (trimmed.startsWith(SLACK_TOKEN_PREFIXES.slack_user_token)) return 'slack_user_token';
  return undefined;
}

/** A Slack channel's id: `C…` (or `G…` for an older private channel), capitals and digits. */
export const SLACK_CHANNEL_ID_PATTERN = /^[CG][A-Z0-9]{6,20}$/;

/** Where a person makes a Slack app and its tokens (its OAuth & Permissions page). */
export const SLACK_APPS_PAGE = 'https://api.slack.com/apps';

/**
 * What a Slack part can do, each needing its scopes: reading public channels (`read`), private ones too, the users,
 * posting, posting under the agent's name and icon (`customize`), reading and posting DMs, searching, reacting.
 */
export const SLACK_CAPABILITIES = [
  'read',
  'privateChannels',
  'users',
  'post',
  'customize',
  'dmsRead',
  'dmsPost',
  'search',
  'react',
] as const;
export type SlackCapability = (typeof SLACK_CAPABILITIES)[number];

/** The scopes each capability needs, all of them (a user token's user scopes have the same names). */
export const SLACK_SCOPES: Readonly<Record<SlackCapability, readonly string[]>> = {
  read: ['channels:read', 'channels:history'],
  privateChannels: ['groups:read', 'groups:history'],
  users: ['users:read'],
  post: ['chat:write'],
  customize: ['chat:write.customize'],
  dmsRead: ['im:read', 'im:history'],
  dmsPost: ['im:read', 'im:history', 'im:write', 'chat:write'],
  search: ['search:read'],
  react: ['reactions:write'],
};

/** The scopes a token's account details keep (`accountMeta.scopes`): its strings, none when it says nothing. */
export function slackScopesOf(accountMeta: Readonly<Record<string, unknown>>): string[] {
  const { scopes } = accountMeta;
  return Array.isArray(scopes) ? scopes.filter((scope): scope is string => typeof scope === 'string') : [];
}

/** What a capability lacks on a token: the scopes missing, and whether it needs a user token. */
export interface SlackGap {
  readonly missing: readonly string[];
  readonly userToken: boolean;
}

/** What the token lacks for a capability, or undefined when it has it (search needs a user token too). */
export function slackGap(
  capability: SlackCapability,
  kind: CredentialKind,
  scopes: readonly string[],
): SlackGap | undefined {
  const missing = SLACK_SCOPES[capability].filter((scope) => !scopes.includes(scope));
  const userToken = capability === 'search' && kind !== 'slack_user_token';
  return missing.length === 0 && !userToken ? undefined : { missing, userToken };
}

/** A gap in words, as a tooltip or a refusal says it: "needs chat:write", "needs a user token with search:read". */
export function slackGapWords(gap: SlackGap): string {
  const scopes = gap.missing.join(', ');
  if (gap.userToken) return `needs a user token (xoxp-)${scopes === '' ? '' : ` with ${scopes}`}`;
  return `needs ${scopes}`;
}

/** True when the token has what the capability needs. */
export const slackAllows = (capability: SlackCapability, kind: CredentialKind, scopes: readonly string[]) =>
  slackGap(capability, kind, scopes) === undefined;

/**
 * The rights as the token lets them work: each right whose scopes it lacks turned off, DMs lowered to what it allows
 * (post, then read, then off). The channels stay as chosen.
 */
export function effectiveSlackRights(
  rights: SlackRights,
  kind: CredentialKind,
  scopes: readonly string[],
): SlackRights {
  const allows = (capability: SlackCapability) => slackAllows(capability, kind, scopes);
  const dmsRead = rights.dms !== 'off' && allows('dmsRead');
  const dms = rights.dms === 'post' && allows('dmsPost') ? 'post' : dmsRead ? 'read' : 'off';
  return {
    ...rights,
    read: rights.read && allows('read'),
    post: rights.post && allows('post'),
    dms,
    search: rights.search && rights.read && allows('search') && allows('read'),
    react: rights.react && allows('react'),
  };
}

/** A channel of a part's list as people read it: a name with `#`, an id as it is. */
export const slackChannelWords = (channel: string): string =>
  SLACK_CHANNEL_ID_PATTERN.test(channel) ? channel : `#${channel}`;
