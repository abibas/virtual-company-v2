import { GATEWAY_HEADERS, SECRET_MAX, SECRET_PREFIXES } from '@mwc/shared/credentials';
import type { CredentialKind } from '@mwc/shared/enums';
import { z } from 'zod';

/**
 * The shapes of the secrets the server seals, one per kind (S3.1, docs/subscriptions.md). They are the server's
 * alone: never in `@mwc/shared`, never imported by the web, never in a response. A sealed value is checked against
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

/** The headers a gateway is sent with each request (an API key, a team id): none to 20, names and values checked. */
export const GatewayHeaders = z
  .record(
    z.string(),
    z
      .string()
      .min(1, 'A header value is required')
      .max(SECRET_MAX, `A header value is at most ${SECRET_MAX} characters`)
      .regex(/^[^\r\n]*$/, 'A header value is one line'),
  )
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

/** Each kind's secret shape. */
export const SECRET_SCHEMAS = {
  claude_oauth: ClaudeOauthSecret,
  claude_setup_token: SetupTokenSecret,
  codex_oauth: CodexOauthSecret,
  anthropic_api_key: AnthropicKeySecret,
  openai_api_key: OpenAiKeySecret,
  gateway: GatewaySecret,
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
