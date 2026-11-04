import { describe, expect, it } from 'vitest';
import {
  API_KEY_ALPHABET,
  API_KEY_PATTERN,
  API_KEY_PREFIX_LENGTH,
  API_KEY_PREFIXES,
  API_KEY_SECRET_LENGTH,
  apiKeyKind,
  apiKeyPrefix,
  PERSONAL_KEY_DAYS,
} from '../src/api-keys.ts';
import { ApiKeyKind } from '../src/enums.ts';

const secret = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345';

describe('the API key format', () => {
  it('is mwc_<pk|rk|sc>_ and 32 base62 characters', () => {
    expect(API_KEY_ALPHABET).toHaveLength(62);
    expect(new Set(API_KEY_ALPHABET).size).toBe(62);
    expect(secret).toHaveLength(API_KEY_SECRET_LENGTH);
    for (const kind of ApiKeyKind.options) {
      const key = `mwc_${API_KEY_PREFIXES[kind]}_${secret}`;
      expect(API_KEY_PATTERN.test(key)).toBe(true);
      expect(apiKeyKind(key)).toBe(kind);
    }
  });

  it.each([
    `mwc_xx_${secret}`,
    `mwc_pk_${secret}x`,
    `mwc_pk_${secret.slice(1)}`,
    `mwc_pk_${secret.slice(1)}!`,
    ` mwc_pk_${secret}`,
    `mwc_pk_${secret}\n`,
    'mwc_pk_',
    '',
  ])('refuses %j', (key) => {
    expect(apiKeyKind(key)).toBeNull();
  });

  it('keeps mwc_<kind>_ and 4 characters of the secret as the display prefix', () => {
    expect(API_KEY_PREFIX_LENGTH).toBe(11);
    expect(apiKeyPrefix(`mwc_pk_${secret}`)).toBe('mwc_pk_AbCd');
  });

  it('gives personal keys 90 days by default, 1 to 365', () => {
    expect(PERSONAL_KEY_DAYS).toEqual({ default: 90, min: 1, max: 365 });
  });
});
