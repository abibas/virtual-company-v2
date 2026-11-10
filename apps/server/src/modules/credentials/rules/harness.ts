import { HarnessCredential, HarnessGateway } from '@mwc/shared/harness';
import type { KindSecret } from '../schemas/secrets.ts';
import type { AccountMeta } from '../schemas.ts';

/**
 * A subscription as a chat's turn or terminal takes it (S5.1b, docs/harness.md "Credentials and gateways"): each sealed kind's
 * secret mapped to the wire's `HarnessCredential`, a gateway's to `HarnessGateway`, and why one cannot be handed out.
 * Pure: the opening and the refresh are `service/harness.ts`'s.
 */

/** A Claude login's access token is refreshed before a turn when it has less than this left. */
export const CLAUDE_TURN_MARGIN_MS = 60 * 60_000;

/** A Codex login's, as its usage check does it. */
export const CODEX_TURN_MARGIN_MS = 5 * 60_000;

/** Why a subscription is not handed to a turn, in the common error shape (never the secret or a provider's answer). */
export interface HarnessRefusal {
  readonly ok: false;
  readonly status: 422 | 503;
  readonly code:
    | 'credential_not_found'
    | 'credential_revoked'
    | 'credential_needs_sign_in'
    | 'credential_unusable'
    | 'provider_unavailable';
  readonly message: string;
}

const refusal = (status: 422 | 503, code: HarnessRefusal['code'], message: string): HarnessRefusal => ({
  ok: false,
  status,
  code,
  message,
});

export const HARNESS_CREDENTIAL_NOT_FOUND = refusal(
  422,
  'credential_not_found',
  "The access profile's subscription is not its owner's any more",
);
export const HARNESS_CREDENTIAL_REVOKED = refusal(
  422,
  'credential_revoked',
  "The access profile's subscription was revoked; its owner adds it again",
);
export const HARNESS_NEEDS_SIGN_IN = refusal(
  422,
  'credential_needs_sign_in',
  "The access profile's login no longer works; its owner signs in to it again",
);
export const HARNESS_CREDENTIAL_UNUSABLE = refusal(
  422,
  'credential_unusable',
  "The access profile's subscription cannot run this harness",
);
export const HARNESS_PROVIDER_UNAVAILABLE = refusal(
  503,
  'provider_unavailable',
  "The provider did not refresh the login's token; try again in a minute",
);

/** A wire credential checked against its schema; undefined when it does not fit (a token over the limit). */
function checked(credential: unknown): HarnessCredential | undefined {
  const parsed = HarnessCredential.safeParse(credential);
  return parsed.success ? parsed.data : undefined;
}

/**
 * A subscription's secret as a harness takes it: a Claude login's access token, a setup-token, an API key, a Codex
 * login's `auth.json` as its text. Undefined for a gateway, and for a login without the token it needs.
 */
export function harnessCredentialOf(opened: KindSecret): HarnessCredential | undefined {
  switch (opened.kind) {
    case 'claude_oauth': {
      const token = opened.secret.credentials.claudeAiOauth?.accessToken;
      return token ? checked({ kind: 'claude_oauth', token }) : undefined;
    }
    case 'claude_setup_token':
      return checked({ kind: 'claude_setup_token', token: opened.secret.token });
    case 'anthropic_api_key':
      return checked({ kind: 'anthropic_api_key', key: opened.secret.apiKey });
    case 'codex_oauth': {
      const { auth } = opened.secret;
      const usable = Boolean(auth.tokens?.access_token) || Boolean(auth.OPENAI_API_KEY);
      return usable ? checked({ kind: 'codex_oauth', authJson: JSON.stringify(auth) }) : undefined;
    }
    case 'openai_api_key':
      return checked({ kind: 'openai_api_key', key: opened.secret.apiKey });
    default:
      return undefined;
  }
}

/** A gateway as a harness takes it: its address (in its account details, not secret) and its headers. */
export function harnessGatewayOf(opened: KindSecret, accountMeta: AccountMeta): HarnessGateway | undefined {
  if (opened.kind !== 'gateway') return undefined;
  const parsed = HarnessGateway.safeParse({ baseUrl: accountMeta.baseUrl, headers: opened.secret.headers });
  return parsed.success ? parsed.data : undefined;
}
