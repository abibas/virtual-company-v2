import type { CredentialKind, Harness, ProfileProvider, ToolProvider } from './enums.ts';

/** A profile's tool parts' rights (S7.1b) and who a sign-in acts as: `credentials/tool-rights.ts`; in words: `tool-words.ts`. */
export * from './credentials/slack.ts';
export * from './credentials/tool-rights.ts';
export * from './credentials/tool-words.ts';
export type { ToolProvider } from './enums.ts';

/**
 * The personal credential store's contract (docs/subscriptions.md): the limits the API's schemas and the CHECKs of
 * `credentials` and `credential_uses` (`@mwc/db`) both read, and the kinds a person adds by pasting, with the light
 * format each pasted secret has. The secrets' own shapes are the server's, never shared with the web.
 */

/** A subscription's name ("Ihor's Max"), after trimming: 1 to 80 characters (`credentials_label_check`). */
export const CREDENTIAL_LABEL = { min: 1, max: 80 } as const;

/** What used a secret on the server ("usage_check", later "run"): 1 to 80 characters (`credential_uses_purpose_check`). */
export const CREDENTIAL_PURPOSE = { min: 1, max: 80 } as const;

/**
 * The kinds added by pasting a secret, with no call to the provider; the two AI logins (`claude_oauth`, `codex_oauth`)
 * come from the sign-in helper, and the tool sign-ins (`TOOL_CREDENTIAL_KINDS`) are checked with their provider first.
 */
export const PASTED_CREDENTIAL_KINDS = [
  'claude_setup_token',
  'anthropic_api_key',
  'openai_api_key',
  'gateway',
] as const satisfies readonly CredentialKind[];
export type PastedCredentialKind = (typeof PASTED_CREDENTIAL_KINDS)[number];

/** How each pasted secret starts: a light check of a paste, never a call to the provider. */
export const SECRET_PREFIXES = {
  claude_setup_token: 'sk-ant-oat01-',
  anthropic_api_key: 'sk-ant-api',
  openai_api_key: 'sk-',
} as const satisfies Partial<Record<PastedCredentialKind, string>>;

/** The longest pasted token or API key taken, in characters. */
export const SECRET_MAX = 4096;

/**
 * The tool sign-ins (S7.1a, docs/subscriptions.md "Tool sign-ins"): Sign in with GitHub (the GitHub CLI's device
 * sign-in), a pasted GitHub token, an Atlassian site with its API token (Jira and Confluence), and (S7.1e) a Slack
 * app's bot or user token (`credentials/slack.ts`). They live in the same
 * personal store as the AI subscriptions, but never power an AI turn and have no plan limits: an access profile holds
 * them in its tool parts (`TOOL_KINDS`), never as its subscription or gateway.
 */
export const TOOL_CREDENTIAL_KINDS = [
  'github_oauth',
  'github_token',
  'atlassian_api_token',
  'slack_bot_token',
  'slack_user_token',
] as const satisfies readonly CredentialKind[];
export type ToolCredentialKind = (typeof TOOL_CREDENTIAL_KINDS)[number];

/** The tools they sign in to, which are also a profile's tool parts, in the order the pages show them. */
export const TOOL_PROVIDERS = ['github', 'atlassian', 'slack'] as const satisfies readonly ToolProvider[];

/** The tool each tool sign-in is for. */
export const TOOL_PROVIDER_OF = {
  github_oauth: 'github',
  github_token: 'github',
  atlassian_api_token: 'atlassian',
  slack_bot_token: 'slack',
  slack_user_token: 'slack',
} as const satisfies Record<ToolCredentialKind, ToolProvider>;

/** The sign-ins each tool part of a profile takes (S7.1b, one profile since 2026-11-13). */
export const TOOL_KINDS = {
  github: ['github_oauth', 'github_token'],
  atlassian: ['atlassian_api_token'],
  slack: ['slack_bot_token', 'slack_user_token'],
} as const satisfies Record<ToolProvider, readonly ToolCredentialKind[]>;

/** True for a tool sign-in, false for an AI subscription, key or gateway. */
export function isToolKind(kind: CredentialKind): kind is ToolCredentialKind {
  return (TOOL_CREDENTIAL_KINDS as readonly CredentialKind[]).includes(kind);
}

/** How a pasted GitHub token starts: a classic personal access token `ghp_`, a fine-grained one `github_pat_`. */
export const GITHUB_TOKEN_PREFIXES = ['ghp_', 'github_pat_'] as const;

/** An Atlassian Cloud site, as stored: its host, `<name>.atlassian.net`. */
export const ATLASSIAN_SITE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.atlassian\.net$/;

/**
 * A site as typed (`https://Airia.atlassian.net/jira/`, `airia.atlassian.net`, or just `airia`) as its host
 * (`airia.atlassian.net`); undefined when it is not an Atlassian Cloud site.
 */
export function atlassianSite(input: string): string | undefined {
  const host = (
    input
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .split(/[/?#]/)[0] ?? ''
  ).replace(/\.$/, '');
  const full = host !== '' && !host.includes('.') ? `${host}.atlassian.net` : host;
  return ATLASSIAN_SITE.test(full) ? full : undefined;
}

/** Where a person makes an Atlassian API token. */
export const ATLASSIAN_TOKEN_PAGE = 'https://id.atlassian.com/manage-profile/security/api-tokens';

/** How many headers a gateway sends with each request: none (a local proxy needs none) to 20. */
export const GATEWAY_HEADERS = { min: 0, max: 20 } as const;

/**
 * A gateway's header as its page shows it: the name in full and a preview of the value (`agk-NTE5••••MHx8`), made by
 * the server when the value is sealed; never the value itself.
 */
export interface GatewayHeaderPreview {
  readonly name: string;
  readonly preview: string;
}

/** An access profile's name ("Work"), after trimming: 1 to 80 characters, unique per owner (`access_profiles_name_check`). */
export const ACCESS_PROFILE_NAME = { min: 1, max: 80 } as const;

/**
 * The credential kinds a profile's AI parts hold (docs/subscriptions.md "Profiles"): its Claude part one Claude
 * subscription, for `claude_code` agents; its OpenAI part one OpenAI subscription, for `codex` agents; either also takes
 * any of its owner's gateways (`GATEWAY_KINDS`: gateways are universal since 2026-11-10). Its tool parts take its owner's
 * tool sign-ins (`TOOL_KINDS`). A profile holds its owner's own credentials, never a revoked one.
 */
export const PROVIDER_KINDS = {
  claude: ['claude_oauth', 'claude_setup_token', 'anthropic_api_key'],
  openai: ['codex_oauth', 'openai_api_key'],
} as const satisfies Record<ProfileProvider, readonly CredentialKind[]>;

/** The kinds a profile's gateway takes. */
export const GATEWAY_KINDS = ['gateway'] as const satisfies readonly CredentialKind[];

/** A profile's AI parts, in the order the pages show them. */
export const PROFILE_PROVIDERS = ['claude', 'openai'] as const satisfies readonly ProfileProvider[];

/**
 * A profile's parts (generic profiles since 2026-11-13: a name and any of these), in the order its card shows them: the
 * AI parts, then the tool parts.
 */
export const PROFILE_PARTS = [...PROFILE_PROVIDERS, ...TOOL_PROVIDERS] as const;
export type ProfilePart = (typeof PROFILE_PARTS)[number];

/** Each part's name, as the pages and messages say it. */
export const PART_NAMES = {
  claude: 'Claude',
  openai: 'OpenAI',
  github: 'GitHub',
  atlassian: 'Atlassian',
  slack: 'Slack',
} as const satisfies Record<ProfilePart, string>;

/** True for a Claude or an OpenAI part, false for a tool part. */
export function isAiPart(part: ProfilePart): part is ProfileProvider {
  return (PROFILE_PROVIDERS as readonly string[]).includes(part);
}

/** The AI part a harness runs on: a profile's Claude part for Claude Code, its OpenAI part for Codex. */
export const HARNESS_PROVIDER = {
  claude_code: 'claude',
  codex: 'openai',
} as const satisfies Record<Harness, ProfileProvider>;

/** True when a credential of `kind` is the subscription of a profile's `provider` part. */
export function fitsProvider(provider: ProfileProvider, kind: CredentialKind): boolean {
  return (PROVIDER_KINDS[provider] as readonly CredentialKind[]).includes(kind);
}

/** True when a credential of `kind` is a sign-in a profile's `tool` part takes. */
export function fitsTool(tool: ToolProvider, kind: CredentialKind): boolean {
  return (TOOL_KINDS[tool] as readonly CredentialKind[]).includes(kind);
}

/** True when a credential of `kind` may be a profile's gateway. */
export function fitsGateway(kind: CredentialKind): boolean {
  return (GATEWAY_KINDS as readonly CredentialKind[]).includes(kind);
}

/**
 * The ways a turn reaches a gateway (since 2026-11-10, docs/subscriptions.md "Gateways"): Claude Code (its
 * `ANTHROPIC_BASE_URL`), Codex signed in with ChatGPT, and Codex with an OpenAI API key (each Codex's custom model
 * provider `base_url`). One gateway serves all three, each at its own path under the gateway's address.
 */
export const GATEWAY_ROUTES = ['claude', 'codexChatgpt', 'codexApiKey'] as const;
export type GatewayRoute = (typeof GATEWAY_ROUTES)[number];

/** Each route's path when the gateway names none: Claude Code at the root, Codex's ChatGPT backend, OpenAI's `/v1`. */
export const DEFAULT_GATEWAY_PATHS = {
  claude: '',
  codexChatgpt: '/backend-api/codex',
  codexApiKey: '/v1',
} as const satisfies Record<GatewayRoute, string>;

/** The longest path a gateway names for a route, in characters. */
export const GATEWAY_PATH_MAX = 512;

/** A gateway's own paths, as its account details keep them (`accountMeta.paths`): any route left out takes its default. */
export type GatewayPaths = { readonly [R in GatewayRoute]?: string };

/** The route a turn takes: Claude Code's; Codex's by its credential, an OpenAI API key or else a ChatGPT login. */
export function gatewayRouteOf(harness: Harness, kind: CredentialKind): GatewayRoute {
  if (harness === 'claude_code') return 'claude';
  return kind === 'openai_api_key' ? 'codexApiKey' : 'codexChatgpt';
}

/** A gateway's path for each route, from its account details: its own where it names a string, else the default. */
export function gatewayPathsOf(accountMeta: Readonly<Record<string, unknown>>): Record<GatewayRoute, string> {
  const own = accountMeta.paths;
  const named = (route: GatewayRoute): unknown =>
    typeof own === 'object' && own !== null ? (own as Record<string, unknown>)[route] : undefined;
  return Object.fromEntries(
    GATEWAY_ROUTES.map((route) => {
      const path = named(route);
      return [route, typeof path === 'string' ? path : DEFAULT_GATEWAY_PATHS[route]];
    }),
  ) as Record<GatewayRoute, string>;
}

const trimSlashes = (text: string, edge: RegExp) => text.trim().replace(edge, '');

/**
 * An address with a path joined to it: no double slash and no trailing one (`http://127.0.0.1:8300/` and `/v1/` give
 * `http://127.0.0.1:8300/v1`), an empty path (or `/`) leaving the address itself, and an address that already ends with
 * the path kept as it is (a gateway added as `…/backend-api/codex` keeps working).
 */
export function joinGatewayPath(address: string, path: string): string {
  const base = trimSlashes(address, /\/+$/);
  const segment = trimSlashes(trimSlashes(path, /^\/+/), /\/+$/);
  if (segment === '') return base;
  const suffix = `/${segment}`;
  return base.endsWith(suffix) ? base : `${base}${suffix}`;
}

/** The address a route reaches a gateway at, from its account details; undefined when they hold no address. */
export function gatewayAddressOf(
  accountMeta: Readonly<Record<string, unknown>>,
  route: GatewayRoute,
): string | undefined {
  const { baseUrl } = accountMeta;
  if (typeof baseUrl !== 'string' || baseUrl.trim() === '') return undefined;
  return joinGatewayPath(baseUrl, gatewayPathsOf(accountMeta)[route]);
}
