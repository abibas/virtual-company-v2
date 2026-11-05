import { describe, expect, it } from 'vitest';
import {
  auditedProfile,
  PROFILE_NOT_FOUND,
  profileChanges,
  profileNameTaken,
  slotRefusal,
  slotsPutIn,
} from '../../../../src/modules/credentials/rules/profiles.ts';

const profile = {
  name: 'Work',
  claudeCredentialId: 'c1',
  openaiCredentialId: null,
  gatewayCredentialId: 'g1',
};

describe('slotRefusal', () => {
  it.each([
    ['claude', 'claude_oauth'],
    ['claude', 'claude_setup_token'],
    ['claude', 'anthropic_api_key'],
    ['openai', 'codex_oauth'],
    ['openai', 'openai_api_key'],
    ['gateway', 'gateway'],
  ] as const)('lets the %s slot take an active or signed-out %s', (slot, kind) => {
    expect(slotRefusal(slot, { kind, status: 'active' })).toBeUndefined();
    expect(slotRefusal(slot, { kind, status: 'needs_sign_in' })).toBeUndefined();
  });

  it.each([
    ['claude', 'codex_oauth'],
    ['claude', 'openai_api_key'],
    ['claude', 'gateway'],
    ['openai', 'claude_oauth'],
    ['openai', 'anthropic_api_key'],
    ['gateway', 'claude_setup_token'],
  ] as const)('refuses the %s slot a %s', (slot, kind) => {
    expect(slotRefusal(slot, { kind, status: 'active' })).toMatchObject({
      ok: false,
      status: 422,
      code: 'credential_kind_mismatch',
    });
  });

  it('refuses none of the owner’s, and a revoked one, naming the slot', () => {
    expect(slotRefusal('openai', undefined)).toEqual({
      ok: false,
      status: 422,
      code: 'credential_not_found',
      message: 'No such subscription of yours for the OpenAI slot',
    });
    expect(slotRefusal('gateway', { kind: 'gateway', status: 'revoked' })).toMatchObject({
      status: 422,
      code: 'credential_revoked',
      message: expect.stringContaining('the gateway slot'),
    });
    expect(slotRefusal('claude', { kind: 'openai_api_key', status: 'revoked' })).toMatchObject({
      code: 'credential_kind_mismatch',
      message: 'The Claude slot does not take a subscription of kind openai_api_key',
    });
  });
});

describe('slotsPutIn', () => {
  it('lists the slots given a credential the profile does not hold there yet', () => {
    expect(slotsPutIn({}, { claudeCredentialId: 'c1', openaiCredentialId: null })).toEqual([
      ['claude', 'c1'],
    ]);
    expect(
      slotsPutIn(profile, { claudeCredentialId: 'c1', openaiCredentialId: 'o1', gatewayCredentialId: 'g2' }),
    ).toEqual([
      ['openai', 'o1'],
      ['gateway', 'g2'],
    ]);
    expect(slotsPutIn(profile, { claudeCredentialId: null, gatewayCredentialId: undefined })).toEqual([]);
  });
});

describe('profileChanges', () => {
  it('keeps only what differs: a name, a slot changed or emptied', () => {
    expect(profileChanges(profile, { name: 'Work', claudeCredentialId: 'c1' })).toEqual({});
    expect(profileChanges(profile, {})).toEqual({});
    expect(
      profileChanges(profile, {
        name: 'Home',
        claudeCredentialId: null,
        openaiCredentialId: 'o1',
        gatewayCredentialId: undefined,
      }),
    ).toEqual({ name: 'Home', claudeCredentialId: null, openaiCredentialId: 'o1' });
  });
});

describe('a profile’s refusals and audit fields', () => {
  it('answers another person’s profile as none, and a taken name with 409', () => {
    expect(PROFILE_NOT_FOUND).toMatchObject({ status: 404, code: 'access_profile_not_found' });
    expect(profileNameTaken('Work')).toEqual({
      ok: false,
      status: 409,
      code: 'access_profile_name_taken',
      message: 'You have an access profile named Work already',
    });
  });

  it('audits its owner, name and slots, nothing else', () => {
    const row = { ...profile, id: 'p1', ownerUserId: 'u1', createdAt: new Date(), updatedAt: new Date() };
    expect(auditedProfile(row)).toEqual({ ownerUserId: 'u1', ...profile });
  });
});
