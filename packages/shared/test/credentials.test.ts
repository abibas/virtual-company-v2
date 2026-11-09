import { describe, expect, it } from 'vitest';
import {
  ACCESS_PROFILE_NAME,
  CREDENTIAL_LABEL,
  CREDENTIAL_PURPOSE,
  fitsSlot,
  GATEWAY_HEADERS,
  PASTED_CREDENTIAL_KINDS,
  PROFILE_SLOT_KINDS,
  PROFILE_SLOTS,
  SECRET_MAX,
  SECRET_PREFIXES,
} from '../src/credentials.ts';
import { CredentialKind } from '../src/enums.ts';

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

  it('puts every kind in exactly one slot of an access profile', () => {
    expect(PROFILE_SLOTS).toEqual(Object.keys(PROFILE_SLOT_KINDS));
    for (const kind of CredentialKind.options) {
      expect(PROFILE_SLOTS.filter((slot) => fitsSlot(slot, kind))).toHaveLength(1);
    }
    expect(PROFILE_SLOTS.filter((slot) => fitsSlot(slot, 'claude_oauth'))).toEqual(['claude']);
    expect(fitsSlot('claude', 'claude_setup_token')).toBe(true);
    expect(fitsSlot('claude', 'anthropic_api_key')).toBe(true);
    expect(fitsSlot('openai', 'codex_oauth')).toBe(true);
    expect(fitsSlot('openai', 'openai_api_key')).toBe(true);
    expect(fitsSlot('gateway', 'gateway')).toBe(true);
    expect(fitsSlot('claude', 'openai_api_key')).toBe(false);
    expect(fitsSlot('openai', 'gateway')).toBe(false);
    expect(fitsSlot('gateway', 'claude_oauth')).toBe(false);
  });
});
