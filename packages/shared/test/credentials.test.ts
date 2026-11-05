import { describe, expect, it } from 'vitest';
import {
  CREDENTIAL_LABEL,
  CREDENTIAL_PURPOSE,
  GATEWAY_HEADERS,
  PASTED_CREDENTIAL_KINDS,
  SECRET_MAX,
  SECRET_PREFIXES,
} from '../src/credentials.ts';
import { CredentialKind } from '../src/enums.ts';

describe('the credential store contract', () => {
  it('holds the limits the credentials and credential_uses CHECKs hold', () => {
    expect(CREDENTIAL_LABEL).toEqual({ min: 1, max: 80 });
    expect(CREDENTIAL_PURPOSE).toEqual({ min: 1, max: 80 });
    expect(GATEWAY_HEADERS).toEqual({ min: 1, max: 20 });
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
});
