import { describe, expect, it } from 'vitest';
import {
  ACCESS_PROFILE_NAME,
  CREDENTIAL_LABEL,
  CREDENTIAL_PURPOSE,
  fitsGateway,
  fitsProvider,
  GATEWAY_HEADERS,
  GATEWAY_KINDS,
  HARNESS_PROVIDER,
  PASTED_CREDENTIAL_KINDS,
  PROFILE_PROVIDERS,
  PROVIDER_KINDS,
  profileFitsHarness,
  SECRET_MAX,
  SECRET_PREFIXES,
} from '../src/credentials.ts';
import { CredentialKind, Harness, ProfileProvider } from '../src/enums.ts';

describe('the credential store contract', () => {
  it('holds the limits the credentials and credential_uses CHECKs hold', () => {
    expect(CREDENTIAL_LABEL).toEqual({ min: 1, max: 80 });
    expect(CREDENTIAL_PURPOSE).toEqual({ min: 1, max: 80 });
    expect(GATEWAY_HEADERS).toEqual({ min: 0, max: 20 });
    expect(SECRET_MAX).toBe(4096);
  });

  it('pastes four kinds; the two logins come from the sign-in helper', () => {
    expect(PASTED_CREDENTIAL_KINDS).toEqual([
      'claude_setup_token',
      'anthropic_api_key',
      'openai_api_key',
      'gateway',
    ]);
    const pasted: readonly string[] = PASTED_CREDENTIAL_KINDS;
    const signedIn = CredentialKind.options.filter((kind) => !pasted.includes(kind));
    expect(signedIn).toEqual(['claude_oauth', 'codex_oauth']);
  });

  it('names the start of each pasted token and key', () => {
    expect(SECRET_PREFIXES).toEqual({
      claude_setup_token: 'sk-ant-oat01-',
      anthropic_api_key: 'sk-ant-api',
      openai_api_key: 'sk-',
    });
  });

  it('names an access profile in 1 to 80 characters', () => {
    expect(ACCESS_PROFILE_NAME).toEqual({ min: 1, max: 80 });
  });

  it('gives every kind to exactly one part of a profile: a provider’s subscription or a Claude profile’s gateway', () => {
    expect(PROFILE_PROVIDERS).toEqual(ProfileProvider.options);
    expect(PROFILE_PROVIDERS).toEqual(Object.keys(PROVIDER_KINDS));
    for (const kind of CredentialKind.options) {
      const fits = [
        ...PROFILE_PROVIDERS.filter((provider) => fitsProvider(provider, kind)),
        fitsGateway(kind),
      ];
      expect(fits.filter(Boolean), kind).toHaveLength(1);
    }
    expect(GATEWAY_KINDS).toEqual(['gateway']);
    expect(fitsProvider('claude', 'claude_oauth')).toBe(true);
    expect(fitsProvider('claude', 'claude_setup_token')).toBe(true);
    expect(fitsProvider('claude', 'anthropic_api_key')).toBe(true);
    expect(fitsProvider('openai', 'codex_oauth')).toBe(true);
    expect(fitsProvider('openai', 'openai_api_key')).toBe(true);
    expect(fitsProvider('claude', 'openai_api_key')).toBe(false);
    expect(fitsProvider('openai', 'claude_oauth')).toBe(false);
    expect(fitsProvider('openai', 'gateway')).toBe(false);
    expect(fitsGateway('gateway')).toBe(true);
    expect(fitsGateway('claude_oauth')).toBe(false);
  });

  it('runs each harness on profiles of one provider', () => {
    expect(HARNESS_PROVIDER).toEqual({ claude_code: 'claude', codex: 'openai' });
    for (const harness of Harness.options) {
      expect(PROFILE_PROVIDERS.filter((provider) => profileFitsHarness(provider, harness))).toEqual([
        HARNESS_PROVIDER[harness],
      ]);
    }
  });
});
