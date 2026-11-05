import { CREDENTIAL_LABEL } from '@mwc/shared/credentials';
import {
  ClaudeCredentialsFile,
  ClaudeOauthAccount,
  CodexAuthFile,
  type KindSecret,
} from '../schemas/secrets.ts';
import type { AccountMeta } from '../schemas.ts';

/**
 * What a finished CLI login leaves in its sandbox's home, made into what the store keeps (S3.2): the secret (the
 * login's files, as the CLI wrote them), the account's email and its non-secret details, and a default name. Pure: the
 * files come in as text. A file that is missing, not JSON or not the CLI's shape is a failed sign-in, said in plain
 * words: never the parser's message, which can quote the file.
 */

/** The files each login is read from, under the sandbox's home. */
export const LOGIN_FILES = {
  claudeCredentials: '.claude/.credentials.json',
  claudeConfig: '.claude.json',
  /** Where Claude keeps its config when CLAUDE_CONFIG_DIR points at `~/.claude`: read when the first is absent. */
  claudeConfigInDir: '.claude/.claude.json',
  codexAuth: '.codex/auth.json',
} as const;

/** A login made ready for `storeCredential`. */
export type LoginResult = KindSecret & {
  readonly accountEmail: string | null;
  readonly accountMeta: AccountMeta;
  readonly label: string;
};

export type LoginOutcome =
  | { readonly ok: true; readonly result: LoginResult }
  | { readonly ok: false; readonly message: string };

/** JSON text as a value; undefined for no text or text that is not JSON (the parser's message is dropped). */
function parseJson(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** "Claude · ihor@example.com", cut to fit a name; just the provider's name without an email. */
export function defaultLabel(provider: string, email: string | null): string {
  const label = email === null ? provider : `${provider} · ${email}`;
  return label.length <= CREDENTIAL_LABEL.max ? label : `${label.slice(0, CREDENTIAL_LABEL.max - 1)}…`;
}

/** The entries whose value is set (not undefined or null). */
function present(entries: Record<string, unknown>): AccountMeta {
  return Object.fromEntries(
    Object.entries(entries).filter(([, value]) => value !== undefined && value !== null),
  );
}

const failed = (message: string): LoginOutcome => ({ ok: false, message });

/**
 * Claude's login: `.claude/.credentials.json` (its token set, which must hold an access token) and the `oauthAccount`
 * of `.claude.json` (who signed in; null when the CLI wrote none). The email names the subscription; the organization,
 * plan, rate limit tier and scopes are its details.
 */
export function claudeLogin(files: {
  readonly credentials: string | undefined;
  readonly config: string | undefined;
}): LoginOutcome {
  const credentials = ClaudeCredentialsFile.safeParse(parseJson(files.credentials));
  const oauth = credentials.success ? credentials.data.claudeAiOauth : undefined;
  if (!credentials.success || !oauth?.accessToken)
    return failed('Claude finished without saving a login. Start again.');
  const config = parseJson(files.config) as { oauthAccount?: unknown } | undefined;
  const parsed = ClaudeOauthAccount.safeParse(config?.oauthAccount);
  const account = parsed.success ? parsed.data : null;
  const accountEmail = account?.emailAddress ?? null;
  return {
    ok: true,
    result: {
      kind: 'claude_oauth',
      secret: { credentials: credentials.data, account },
      accountEmail,
      accountMeta: present({
        organizationName: account?.organizationName,
        subscriptionType: oauth.subscriptionType,
        rateLimitTier: oauth.rateLimitTier,
        scopes: oauth.scopes,
      }),
      label: defaultLabel('Claude', accountEmail),
    },
  };
}

/** A JWT's claims, decoded for display only: the signature is not checked, so nothing is decided on them. */
export function jwtClaims(token: string | undefined): Record<string, unknown> | undefined {
  const payload = token?.split('.')[1];
  if (payload === undefined) return undefined;
  const claims = parseJson(Buffer.from(payload, 'base64url').toString('utf8'));
  return typeof claims === 'object' && claims !== null ? (claims as Record<string, unknown>) : undefined;
}

/** The claim OpenAI puts its account details under in an id_token. */
const OPENAI_AUTH_CLAIM = 'https://api.openai.com/auth';

const stringOrUndefined = (value: unknown) => (typeof value === 'string' ? value : undefined);

/**
 * OpenAI's login: Codex's `.codex/auth.json`, which must hold an access token. The email (the id_token's `email`) names
 * the subscription and the ChatGPT plan is its detail.
 */
export function codexLogin(files: { readonly auth: string | undefined }): LoginOutcome {
  const auth = CodexAuthFile.safeParse(parseJson(files.auth));
  if (!auth.success || !auth.data.tokens?.access_token) {
    return failed('Codex finished without saving a login. Start again.');
  }
  const claims = jwtClaims(auth.data.tokens.id_token);
  const accountEmail = stringOrUndefined(claims?.email) ?? null;
  const openai = claims?.[OPENAI_AUTH_CLAIM] as Record<string, unknown> | undefined;
  return {
    ok: true,
    result: {
      kind: 'codex_oauth',
      secret: { auth: auth.data },
      accountEmail,
      accountMeta: present({ planType: stringOrUndefined(openai?.chatgpt_plan_type) }),
      label: defaultLabel('OpenAI', accountEmail),
    },
  };
}
