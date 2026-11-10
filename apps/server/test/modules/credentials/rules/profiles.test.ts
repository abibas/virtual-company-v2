import { describe, expect, it } from 'vitest';
import {
  auditedProfile,
  credentialRefusal,
  GATEWAY_CLAUDE_ONLY,
  gatewayRefusal,
  PROFILE_NOT_FOUND,
  partsPutIn,
  profileChanges,
  profileNameTaken,
  providerFixed,
} from '../../../../src/modules/credentials/rules/profiles.ts';

const profile = { name: 'Work', credentialId: 'c1', gatewayCredentialId: 'g1' };

describe('credentialRefusal', () => {
  it.each([
    ['claude', 'claude_oauth'],
    ['claude', 'claude_setup_token'],
    ['claude', 'anthropic_api_key'],
    ['openai', 'codex_oauth'],
    ['openai', 'openai_api_key'],
  ] as const)('lets a %s profile take an active or signed-out %s subscription', (provider, kind) => {
    expect(credentialRefusal('subscription', provider, { kind, status: 'active' })).toBeUndefined();
    expect(credentialRefusal('subscription', provider, { kind, status: 'needs_sign_in' })).toBeUndefined();
  });

  it.each([
    ['claude', 'codex_oauth'],
    ['claude', 'openai_api_key'],
    ['claude', 'gateway'],
    ['openai', 'claude_oauth'],
    ['openai', 'anthropic_api_key'],
    ['openai', 'gateway'],
  ] as const)('refuses a %s profile a %s subscription: another provider', (provider, kind) => {
    expect(credentialRefusal('subscription', provider, { kind, status: 'active' })).toMatchObject({
      ok: false,
      status: 422,
      code: 'provider_mismatch',
    });
  });

  it('takes only a gateway as a gateway', () => {
    expect(credentialRefusal('gateway', 'claude', { kind: 'gateway', status: 'active' })).toBeUndefined();
    expect(credentialRefusal('gateway', 'claude', { kind: 'claude_oauth', status: 'active' })).toEqual({
      ok: false,
      status: 422,
      code: 'credential_kind_mismatch',
      message: "A profile's gateway is a gateway, not one of kind claude_oauth",
    });
  });

  it('refuses none of the owner’s, and a revoked one, naming the part; the provider first', () => {
    expect(credentialRefusal('subscription', 'openai', undefined)).toEqual({
      ok: false,
      status: 422,
      code: 'credential_not_found',
      message: 'No such subscription of yours for its subscription',
    });
    expect(credentialRefusal('gateway', 'claude', { kind: 'gateway', status: 'revoked' })).toMatchObject({
      status: 422,
      code: 'credential_revoked',
      message: expect.stringContaining('its gateway'),
    });
    expect(
      credentialRefusal('subscription', 'claude', { kind: 'openai_api_key', status: 'revoked' }),
    ).toEqual({
      ok: false,
      status: 422,
      code: 'provider_mismatch',
      message:
        'A Claude profile takes a Claude subscription (claude_oauth, claude_setup_token, anthropic_api_key), not one ' +
        'of kind openai_api_key',
    });
  });
});

describe('gatewayRefusal', () => {
  it('refuses a gateway put in an OpenAI profile, and nothing else', () => {
    expect(gatewayRefusal('openai', { gatewayCredentialId: 'g1' })).toBe(GATEWAY_CLAUDE_ONLY);
    expect(GATEWAY_CLAUDE_ONLY).toMatchObject({ status: 422, code: 'gateway_not_allowed' });
    expect(gatewayRefusal('openai', { gatewayCredentialId: null, credentialId: 'o1' })).toBeUndefined();
    expect(gatewayRefusal('openai', {})).toBeUndefined();
    expect(gatewayRefusal('claude', { gatewayCredentialId: 'g1' })).toBeUndefined();
  });
});

describe('partsPutIn', () => {
  it('lists the parts given a credential the profile does not hold there yet', () => {
    expect(partsPutIn({}, { credentialId: 'c1', gatewayCredentialId: null })).toEqual([
      ['subscription', 'c1'],
    ]);
    expect(partsPutIn(profile, { credentialId: 'c2', gatewayCredentialId: 'g2' })).toEqual([
      ['subscription', 'c2'],
      ['gateway', 'g2'],
    ]);
    expect(partsPutIn(profile, { credentialId: 'c1', gatewayCredentialId: undefined })).toEqual([]);
    expect(partsPutIn(profile, { credentialId: null })).toEqual([]);
  });
});

describe('profileChanges', () => {
  it('keeps only what differs: a name, a subscription or gateway changed or emptied', () => {
    expect(profileChanges(profile, { name: 'Work', credentialId: 'c1' })).toEqual({});
    expect(profileChanges(profile, {})).toEqual({});
    expect(profileChanges(profile, { name: 'Home', credentialId: null, gatewayCredentialId: 'g2' })).toEqual({
      name: 'Home',
      credentialId: null,
      gatewayCredentialId: 'g2',
    });
  });
});

describe('a profile’s refusals and audit fields', () => {
  it('answers another person’s profile as none, a taken name with 409, another provider with 422', () => {
    expect(PROFILE_NOT_FOUND).toMatchObject({ status: 404, code: 'access_profile_not_found' });
    expect(profileNameTaken('Work')).toEqual({
      ok: false,
      status: 409,
      code: 'access_profile_name_taken',
      message: 'You have an access profile named Work already',
    });
    expect(providerFixed('openai')).toMatchObject({
      status: 422,
      code: 'provider_mismatch',
      message: expect.stringContaining('This is an OpenAI profile'),
    });
    expect(providerFixed('claude').message).toContain('This is a Claude profile');
  });

  it('audits its owner, name, provider and credentials, nothing else', () => {
    const row = {
      ...profile,
      id: 'p1',
      ownerUserId: 'u1',
      provider: 'claude' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(auditedProfile(row)).toEqual({ ownerUserId: 'u1', provider: 'claude', ...profile });
  });
});
