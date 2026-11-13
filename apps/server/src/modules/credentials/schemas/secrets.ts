import {
  ATLASSIAN_SITE,
  GATEWAY_HEADERS,
  GITHUB_TOKEN_PREFIXES,
  SECRET_MAX,
  SECRET_PREFIXES,
  SLACK_TOKEN_PREFIXES,
} from '@mwc/shared/credentials';
import type { CredentialKind } from '@mwc/shared/enums';
import { z } from 'zod';

/**
 * The shapes of the secrets the server seals, one per kind (S3.1, docs/subscriptions.md; the tool sign-ins' since
 * S7.1a). They are the server's alone: never in `@mwc/shared`, never imported by the web, never in a response. A
 * sealed value is checked against
 * its kind's shape when it is stored and again when it is opened. The two logins (written by the sign-in helper,
 * S3.2, and refreshed by the limits checks, S3.3) are typed permissively: the fields named are the ones known today,
 * all optional, and anything else the CLI writes is kept as it is.
 */

/** A pasted token or key: trimmed, one word, at most SECRET_MAX characters, starting with its kind's prefix. */
const pastedSecret = (prefix: string, what: string) =>
  z
    .string()
    .trim()
    .min(1, `${what} is required`)
    .max(SECRET_MAX, `${what} is at most ${SECRET_MAX} characters`)
    .regex(/^\S+$/, `${what} has no spaces in it`)
    .startsWith(prefix, `${what} starts with ${prefix}`);

/** The output of `claude setup-token` (inference only, one year). */
export const SetupToken = pastedSecret(SECRET_PREFIXES.claude_setup_token, 'A setup-token');
export const AnthropicApiKey = pastedSecret(SECRET_PREFIXES.anthropic_api_key, 'An Anthropic API key');
export const OpenAiApiKey = pastedSecret(SECRET_PREFIXES.openai_api_key, 'An OpenAI API key');

/** An HTTP header's name: the token characters of RFC 9110, at most 100 of them. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/;

/** A header's name, checked as `GatewayHeaders` checks its keys. */
export const GatewayHeaderName = z
  .string()
  .regex(HEADER_NAME, 'A header name is letters, digits and - _ . only');

/** A header's value: one line of 1 to SECRET_MAX characters. */
export const GatewayHeaderValue = z
  .string()
  .min(1, 'A header value is required')
  .max(SECRET_MAX, `A header value is at most ${SECRET_MAX} characters`)
  .regex(/^[^\r\n]*$/, 'A header value is one line');

/** The headers a gateway is sent with each request (an API key, a team id): none to 20, names and values checked. */
export const GatewayHeaders = z
  .record(z.string(), GatewayHeaderValue)
  .refine(
    (headers) => Object.keys(headers).every((name) => HEADER_NAME.test(name)),
    'A header name is letters, digits and - _ . only',
  )
  .refine(
    (headers) => Object.keys(headers).length <= GATEWAY_HEADERS.max,
    `A gateway takes at most ${GATEWAY_HEADERS.max} headers`,
  );

export const SetupTokenSecret = z.object({ token: SetupToken });
export const AnthropicKeySecret = z.object({ apiKey: AnthropicApiKey });
export const OpenAiKeySecret = z.object({ apiKey: OpenAiApiKey });
/** A gateway's secret is its headers; its base URL is not secret and lives in `account_meta`. */
export const GatewaySecret = z.object({ headers: GatewayHeaders });

/** Claude Code's `.credentials.json`, as the official CLI writes it after its login. */
export const ClaudeCredentialsFile = z.looseObject({
  claudeAiOauth: z
    .looseObject({
      accessToken: z.string().optional(),
      refreshToken: z.string().optional(),
      /** Epoch milliseconds. */
      expiresAt: z.number().optional(),
      scopes: z.array(z.string()).optional(),
      subscriptionType: z.string().nullable().optional(),
      rateLimitTier: z.string().nullable().optional(),
    })
    .optional(),
});

/** The `oauthAccount` object of Claude Code's `.claude.json`: who the login is. */
export const ClaudeOauthAccount = z.looseObject({
  accountUuid: z.string().optional(),
  emailAddress: z.string().optional(),
  organizationUuid: z.string().optional(),
  organizationName: z.string().nullable().optional(),
  displayName: z.string().nullable().optional(),
});

/** A Claude login: the CLI's token set and its account config (null when the CLI wrote none). */
export const ClaudeOauthSecret = z.looseObject({
  credentials: ClaudeCredentialsFile,
  account: ClaudeOauthAccount.nullable(),
});

/** Codex's `auth.json`, as `codex login --device-auth` writes it. */
export const CodexAuthFile = z.looseObject({
  OPENAI_API_KEY: z.string().nullable().optional(),
  tokens: z
    .looseObject({
      id_token: z.string().optional(),
      access_token: z.string().optional(),
      refresh_token: z.string().optional(),
      account_id: z.string().optional(),
    })
    .optional(),
  last_refresh: z.string().optional(),
});

/** An OpenAI login: Codex's `auth.json`. */
export const CodexOauthSecret = z.looseObject({ auth: CodexAuthFile });

/** A token or key of one word, at most SECRET_MAX characters, with no prefix asked of it. */
const oneWord = (what: string) =>
  z
    .string()
    .trim()
    .min(1, `${what} is required`)
    .max(SECRET_MAX, `${what} is at most ${SECRET_MAX} characters`)
    .regex(/^\S+$/, `${what} has no spaces in it`);

/** A pasted GitHub personal access token: classic (`ghp_`) or fine-grained (`github_pat_`), letters, digits and `_`. */
export const GitHubToken = oneWord('A GitHub token')
  .regex(/^[A-Za-z0-9_]+$/, 'A GitHub token is letters, digits and _ only')
  .refine(
    (token) => GITHUB_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix)),
    `A GitHub token starts with ${GITHUB_TOKEN_PREFIXES.join(' or ')}`,
  );

/** An Atlassian API token (newer ones start with `ATATT`; older ones have no prefix). */
export const AtlassianToken = oneWord('An Atlassian API token');

/** The GitHub CLI's OAuth token, as `gh auth token` prints it after its device sign-in. */
export const GitHubOauthSecret = z.object({ token: oneWord('A GitHub token') });
export const GitHubTokenSecret = z.object({ token: GitHubToken });
/** Everything a call to Jira or Confluence needs: the site's host, the account's email and its API token. */
export const AtlassianSecret = z.object({
  site: z.string().regex(ATLASSIAN_SITE),
  email: z.email(),
  token: AtlassianToken,
});

/**
 * A pasted Slack token (S7.1e): a bot's (`xoxb-`) or a user's (`xoxp-`), letters, digits and dashes. Which one it is
 * decides the sign-in's kind.
 */
export const SlackToken = oneWord('A Slack token')
  .regex(/^[A-Za-z0-9-]+$/, 'A Slack token is letters, digits and - only')
  .refine(
    (token) => Object.values(SLACK_TOKEN_PREFIXES).some((prefix) => token.startsWith(prefix)),
    'A Slack token starts with xoxb- (a bot’s) or xoxp- (a user’s)',
  );
const slackSecret = (prefix: string) =>
  z.object({ token: SlackToken.refine((token) => token.startsWith(prefix), `It starts with ${prefix}`) });
export const SlackBotSecret = slackSecret(SLACK_TOKEN_PREFIXES.slack_bot_token);
export const SlackUserSecret = slackSecret(SLACK_TOKEN_PREFIXES.slack_user_token);

/** Each kind's secret shape. */
export const SECRET_SCHEMAS = {
  claude_oauth: ClaudeOauthSecret,
  claude_setup_token: SetupTokenSecret,
  codex_oauth: CodexOauthSecret,
  anthropic_api_key: AnthropicKeySecret,
  openai_api_key: OpenAiKeySecret,
  gateway: GatewaySecret,
  github_oauth: GitHubOauthSecret,
  github_token: GitHubTokenSecret,
  atlassian_api_token: AtlassianSecret,
  slack_bot_token: SlackBotSecret,
  slack_user_token: SlackUserSecret,
} as const satisfies Record<CredentialKind, z.ZodType>;

/** The secret of one kind. */
export type SecretOf<K extends CredentialKind> = z.infer<(typeof SECRET_SCHEMAS)[K]>;

/** A kind with its secret, so code narrows the secret by its kind. */
export type KindSecret = {
  [K in CredentialKind]: { readonly kind: K; readonly secret: SecretOf<K> };
}[CredentialKind];

/** A value checked against its kind's shape; throws a `ZodError` (naming fields, never values) when it is not one. */
export function parseSecret<K extends CredentialKind>(kind: K, value: unknown): SecretOf<K> {
  return SECRET_SCHEMAS[kind].parse(value) as SecretOf<K>;
}
