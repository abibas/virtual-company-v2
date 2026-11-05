import type { CredentialKind } from './enums.ts';

/**
 * The personal credential store's contract (docs/subscriptions.md): the limits the API's schemas and the CHECKs of
 * `credentials` and `credential_uses` (`@mwc/db`) both read, and the kinds a person adds by pasting, with the light
 * format each pasted secret has. The secrets' own shapes are the server's, never shared with the web.
 */

/** A subscription's name ("Ihor's Max"), after trimming: 1 to 80 characters (`credentials_label_check`). */
export const CREDENTIAL_LABEL = { min: 1, max: 80 } as const;

/** What used a secret on the server ("usage_check", later "run"): 1 to 80 characters (`credential_uses_purpose_check`). */
export const CREDENTIAL_PURPOSE = { min: 1, max: 80 } as const;

/** The kinds added by pasting a secret; the two logins (`claude_oauth`, `codex_oauth`) come from the sign-in helper. */
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

/** How many headers a gateway sends with each request: 1 to 20. */
export const GATEWAY_HEADERS = { min: 1, max: 20 } as const;
