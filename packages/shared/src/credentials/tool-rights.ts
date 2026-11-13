import { z } from 'zod';
import type { CredentialKind, ToolProvider } from '../enums.ts';
import { SLACK_CHANNEL_ID_PATTERN, slackScopesOf } from './slack.ts';

/**
 * What an access profile's tool part lets the agents given the profile do with its sign-in (S7.1b, one profile with tool
 * parts since 2026-11-13, docs/subscriptions.md "Tool parts"): its rights, stored on the profile
 * (`access_profiles.github_rights`, `atlassian_rights`, jsonb) and parsed with these schemas wherever they are read, so
 * the API, the database and the agents' briefing agree. The server checks them on each tool call once the tools arrive
 * (S7.1c for Atlassian, S7.1d for GitHub, S7.1e for Slack). A new part starts at the safe end: GitHub reaches no
 * repository until some are chosen, Atlassian reads Jira and Confluence and writes nowhere, Slack reads its channels and
 * posts nowhere.
 */

/** The most repositories, Jira projects, Confluence spaces or Slack channels a part lists. */
export const TOOL_SCOPE_MAX = 100;

/**
 * A GitHub repository as a profile's GitHub part names it: `owner/name`, or `owner/*` for every repository of the owner. The owner is
 * 1 to 39 letters, digits and dashes; the name 1 to 100 letters, digits, `.`, `_` and `-` (not `.` or `..`).
 */
export const GITHUB_REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/(?:\*|(?!\.\.?$)[A-Za-z0-9._-]{1,100})$/;

/** A Jira project key (`AP`): a capital letter, then capitals, digits and `_`, up to 50 in all; typed lower-case is fine. */
export const JIRA_PROJECT_PATTERN = /^[A-Z][A-Z0-9_]{0,49}$/;

/** A Confluence space key (`ENG`, or a personal space's `~` and account id): letters, digits, `_`, `:` and `-`. */
export const CONFLUENCE_SPACE_PATTERN = /^~?[A-Za-z0-9][A-Za-z0-9_:-]{0,99}$/;

/** A list without repeats, the first of each kept (`key` decides what repeats: GitHub's names ignore case). */
const once =
  (key: (item: string) => string = (item) => item) =>
  (items: string[]): string[] => {
    const seen = new Set<string>();
    return items.filter((item) => {
      if (seen.has(key(item))) return false;
      seen.add(key(item));
      return true;
    });
  };

/**
 * A Slack channel's name as stored (`general`: typed with or without `#`, lower-case): letters, digits, `_` and `-`, up
 * to 80, as Slack names channels.
 */
export const SLACK_CHANNEL_NAME_PATTERN = /^[\p{L}\p{M}\p{N}_-]{1,80}$/u;

/** Where a right reaches: `all`, or a list (empty: nowhere yet). */
const scope = (item: z.ZodType<string, string>, key?: (item: string) => string) =>
  z.union([
    z.literal('all'),
    z.array(item).max(TOOL_SCOPE_MAX, `At most ${TOOL_SCOPE_MAX} entries`).transform(once(key)),
  ]);

const GitHubRepo = z
  .string()
  .trim()
  .regex(GITHUB_REPO_PATTERN, 'A repository is owner/name, or owner/* for all of an owner’s');
const JiraProject = z
  .string()
  .trim()
  .toUpperCase()
  .regex(JIRA_PROJECT_PATTERN, 'A Jira project key is a letter, then letters, digits and _');
const ConfluenceSpace = z
  .string()
  .trim()
  .regex(CONFLUENCE_SPACE_PATTERN, 'A Confluence space key is letters, digits, _, : and -');

/** A Slack channel as a profile names it: its id as it is, else its name without `#`, lower-case. */
const SlackChannel = z
  .string()
  .trim()
  .transform((value) => {
    const bare = value.replace(/^#/, '');
    return SLACK_CHANNEL_ID_PATTERN.test(bare) ? bare : bare.toLowerCase();
  })
  .refine(
    (value) => SLACK_CHANNEL_ID_PATTERN.test(value) || SLACK_CHANNEL_NAME_PATTERN.test(value),
    'A Slack channel is its name (#general) or its id (C0123ABCD)',
  );

/**
 * A profile's GitHub rights. Reading is always on, in the repositories it reaches (`repos`: `all` it can see, or a list
 * of `owner/name` and `owner/*`; empty reaches none). `push` pushes branches; `pullRequests` opens and updates pull
 * requests. It never merges, deletes (a branch, a repository, anything), force-pushes, or pushes to a repository's
 * default branch: those are no options, and the tools (S7.1d) refuse them whatever a profile says.
 */
export const GitHubRights = z.strictObject({
  repos: scope(GitHubRepo, (repo) => repo.toLowerCase()),
  push: z.boolean(),
  pullRequests: z.boolean(),
});
export type GitHubRights = z.infer<typeof GitHubRights>;

/** Jira through a profile's Atlassian part: none, reading, or reading and changes (comment, transition, create, edit). */
export const JiraAccess = z.enum(['off', 'read', 'changes']);
export type JiraAccess = z.infer<typeof JiraAccess>;

/** Confluence through a profile's Atlassian part: none, reading, or reading and writing (create and update pages). */
export const ConfluenceAccess = z.enum(['off', 'read', 'write']);
export type ConfluenceAccess = z.infer<typeof ConfluenceAccess>;

/**
 * A profile's Atlassian rights: Jira's access in its projects (`all`, or project keys), Confluence's in its spaces
 * (`all`, or space keys). It never deletes or archives anything, in Jira or in Confluence.
 */
export const AtlassianRights = z.strictObject({
  jira: JiraAccess,
  jiraProjects: scope(JiraProject),
  confluence: ConfluenceAccess,
  confluenceSpaces: scope(ConfluenceSpace),
});
export type AtlassianRights = z.infer<typeof AtlassianRights>;

/** Slack's direct messages through a profile's Slack part: none, reading them, or reading and posting. */
export const SlackDms = z.enum(['off', 'read', 'post']);
export type SlackDms = z.infer<typeof SlackDms>;

/**
 * A profile's Slack rights (S7.1e): `read` (channels' history and threads, the channel list, users), `post` (into
 * channels and threads), the `channels` both reach (`all`, or names and ids), `dms`, `search` (messages, only with a user
 * token that has `search:read`) and `react` (add reactions). The token's own scopes cap them (`effectiveSlackRights`).
 * It never mentions `@here`, `@channel` or `@everyone`, deletes, edits others' messages, invites, kicks or administers.
 */
export const SlackRights = z.strictObject({
  read: z.boolean(),
  post: z.boolean(),
  channels: scope(SlackChannel),
  dms: SlackDms,
  search: z.boolean(),
  react: z.boolean(),
});
export type SlackRights = z.infer<typeof SlackRights>;

/** A tool part's rights, any tool's; the keys tell them apart (GitHub's name repositories, Slack's channels). */
export const ToolRights = z.union([GitHubRights, AtlassianRights, SlackRights]);
export type ToolRights = z.infer<typeof ToolRights>;

/** Each tool's rights. */
export type RightsOf<P extends ToolProvider> = P extends 'github'
  ? GitHubRights
  : P extends 'atlassian'
    ? AtlassianRights
    : SlackRights;

/** Each tool's schema. */
export const TOOL_RIGHTS = { github: GitHubRights, atlassian: AtlassianRights, slack: SlackRights } as const;

const DEFAULT_RIGHTS: { readonly [P in ToolProvider]: RightsOf<P> } = {
  github: { repos: [], push: false, pullRequests: false },
  atlassian: { jira: 'read', jiraProjects: 'all', confluence: 'read', confluenceSpaces: 'all' },
  slack: { read: true, post: false, channels: 'all', dms: 'off', search: false, react: false },
};

const NO_RIGHTS: { readonly [P in ToolProvider]: RightsOf<P> } = {
  github: { repos: [], push: false, pullRequests: false },
  atlassian: { jira: 'off', jiraProjects: [], confluence: 'off', confluenceSpaces: [] },
  slack: { read: false, post: false, channels: [], dms: 'off', search: false, react: false },
};

/**
 * A new part's rights, the safe end: GitHub reaches no repository and only reads; Atlassian reads everywhere; Slack reads
 * its channels and posts nowhere.
 */
export function defaultRights<P extends ToolProvider>(provider: P): RightsOf<P> {
  return structuredClone(DEFAULT_RIGHTS[provider]) as RightsOf<P>;
}

/** No rights at all: what stored rights that do not parse count as, so a damaged row never grants anything. */
export function noRights<P extends ToolProvider>(provider: P): RightsOf<P> {
  return structuredClone(NO_RIGHTS[provider]) as RightsOf<P>;
}

/** A part's stored rights as its tool's (`noRights` when they do not parse as that tool's). */
export function storedRights<P extends ToolProvider>(provider: P, stored: unknown): RightsOf<P> {
  const parsed = TOOL_RIGHTS[provider].safeParse(stored);
  return parsed.success ? (parsed.data as RightsOf<P>) : noRights(provider);
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

/** Who a tool sign-in acts as, and where. */
export interface ToolAccount {
  /**
   * GitHub's login (`ihorherasko`); Atlassian's display name, else the account's email; Slack's bot or user name; null
   * when it says none.
   */
  readonly account: string | null;
  /** The Atlassian site (`airia.atlassian.net`), the Slack workspace (`Airia`); null for GitHub. */
  readonly site: string | null;
  /** Slack only: true for a user token (`xoxp-`), which posts as that person, false for a bot's. */
  readonly asUser?: boolean;
  /** Slack only: the scopes Slack granted the token (`x-oauth-scopes`), which cap the part's rights. */
  readonly scopes?: readonly string[];
}

/** Who a tool sign-in acts as, from its non-secret details (`account_email`, `account_meta`); nothing for another kind. */
export function toolAccountOf(
  kind: CredentialKind,
  accountEmail: string | null,
  accountMeta: Readonly<Record<string, unknown>>,
): ToolAccount {
  if (kind === 'github_oauth' || kind === 'github_token')
    return { account: text(accountMeta.login), site: null };
  if (kind === 'slack_bot_token' || kind === 'slack_user_token') {
    const site = text(accountMeta.team);
    const scopes = slackScopesOf(accountMeta);
    return { account: text(accountMeta.user), site, asUser: kind === 'slack_user_token', scopes };
  }
  if (kind !== 'atlassian_api_token') return { account: null, site: null };
  return { account: text(accountMeta.displayName) ?? text(accountEmail), site: text(accountMeta.site) };
}
