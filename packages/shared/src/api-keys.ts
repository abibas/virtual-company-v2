import type { ApiKeyKind } from './enums.ts';

/**
 * The API key format the server, the `mwc` CLI and (S2.6) `@mwc/mcp` share (docs/architecture.md, "Service auth"):
 * `mwc_<pk|rk|sc>_` and 32 base62 characters, shown once when it is made. The server stores only its SHA-256 and the
 * display prefix below; the CLI checks a key's shape before it sends it anywhere.
 */
export const API_KEY_PATTERN = /^mwc_(pk|rk|sc)_[0-9A-Za-z]{32}$/;

/** The base62 alphabet of a key's secret part. */
export const API_KEY_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** How many base62 characters follow `mwc_<kind>_`. */
export const API_KEY_SECRET_LENGTH = 32;

/** The two letters after `mwc_` for each kind of key. */
export const API_KEY_PREFIXES: Readonly<Record<ApiKeyKind, string>> = {
  personal: 'pk',
  runner: 'rk',
  scim: 'sc',
};

const KIND_OF_PREFIX = new Map<string, ApiKeyKind>([
  ['pk', 'personal'],
  ['rk', 'runner'],
  ['sc', 'scim'],
]);

/** The kind a well-formed key's prefix names, or null for anything that is not an API key. */
export function apiKeyKind(key: string): ApiKeyKind | null {
  return KIND_OF_PREFIX.get(API_KEY_PATTERN.exec(key)?.[1] ?? '') ?? null;
}

/** How many characters of a key `api_keys.prefix` keeps: `mwc_pk_` and the first 4 of the secret. */
export const API_KEY_PREFIX_LENGTH = 11;

/**
 * What a key is recognized by once it is stored (`api_keys.prefix`, e.g. `mwc_pk_AbCd`): never enough to use it.
 * Lists and `mwc whoami` show it followed by an ellipsis.
 */
export function apiKeyPrefix(key: string): string {
  return key.slice(0, API_KEY_PREFIX_LENGTH);
}

/** A personal key's lifetime in days: 90 unless its owner asks for another, at least 1 and at most 365. */
export const PERSONAL_KEY_DAYS = { default: 90, min: 1, max: 365 } as const;
