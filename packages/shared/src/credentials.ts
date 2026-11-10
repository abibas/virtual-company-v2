import type { CredentialKind, Harness, ProfileProvider } from './enums.ts';

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

/** How many headers a gateway sends with each request: none (a local proxy needs none) to 20. */
export const GATEWAY_HEADERS = { min: 0, max: 20 } as const;

/** An access profile's name ("Work"), after trimming: 1 to 80 characters, unique per owner (`access_profiles_name_check`). */
export const ACCESS_PROFILE_NAME = { min: 1, max: 80 } as const;

/**
 * The credential kinds an access profile of each provider holds (docs/subscriptions.md): a Claude profile one Claude
 * subscription, for `claude_code` agents; an OpenAI profile one OpenAI subscription, for `codex` agents. Only a Claude
 * profile also takes a gateway (`GATEWAY_KINDS`). A profile holds its owner's own credentials, never a revoked one.
 */
export const PROVIDER_KINDS = {
  claude: ['claude_oauth', 'claude_setup_token', 'anthropic_api_key'],
  openai: ['codex_oauth', 'openai_api_key'],
} as const satisfies Record<ProfileProvider, readonly CredentialKind[]>;

/** The kinds a Claude profile's gateway takes. */
export const GATEWAY_KINDS = ['gateway'] as const satisfies readonly CredentialKind[];

/** The providers in the order the profiles page groups them. */
export const PROFILE_PROVIDERS = ['claude', 'openai'] as const satisfies readonly ProfileProvider[];

/** The provider whose profiles a harness runs on: Claude for Claude Code, OpenAI for Codex. */
export const HARNESS_PROVIDER = {
  claude_code: 'claude',
  codex: 'openai',
} as const satisfies Record<Harness, ProfileProvider>;

/** True when a credential of `kind` is the subscription of a `provider` profile. */
export function fitsProvider(provider: ProfileProvider, kind: CredentialKind): boolean {
  return (PROVIDER_KINDS[provider] as readonly CredentialKind[]).includes(kind);
}

/** True when a credential of `kind` may be a Claude profile's gateway. */
export function fitsGateway(kind: CredentialKind): boolean {
  return (GATEWAY_KINDS as readonly CredentialKind[]).includes(kind);
}

/** True when a profile of `provider` may power an agent on `harness`. */
export function profileFitsHarness(provider: ProfileProvider, harness: Harness): boolean {
  return HARNESS_PROVIDER[harness] === provider;
}
