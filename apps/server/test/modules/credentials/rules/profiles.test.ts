import type { CredentialKind, CredentialStatus } from '@mwc/shared/enums';
import { describe, expect, it } from 'vitest';
import {
  auditedProfile,
  credentialRefusal,
  PROFILE_NOT_FOUND,
  partsPutIn,
  profileChanges,
  profileNameTaken,
  providerFixed,
} from '../../../../src/modules/credentials/rules/profiles.ts';

const profile = {
  name: 'Work',
  credentialId: 'c1',
  gatewayCredentialId: 'g1',
  model: 'claude-opus-5-5',
  effort: 'high' as const,
  githubCredentialId: null,
  githubRights: null,
  atlassianCredentialId: null,
  atlassianRights: null,
};

/** A credential as the rules read it: its kind, state and account details (none by default). */
const held = (kind: CredentialKind, status: CredentialStatus = 'active') => ({ kind, status });

describe('credentialRefusal', () => {
  it.each([
    ['claude', 'claude_oauth'],
    ['claude', 'claude_setup_token'],
    ['claude', 'anthropic_api_key'],
    ['openai', 'codex_oauth'],
    ['openai', 'openai_api_key'],
  ] as const)('lets a %s profile take an active or signed-out %s subscription', (provider, kind) => {
    expect(credentialRefusal('subscription', provider, held(kind))).toBeUndefined();
    expect(credentialRefusal('subscription', provider, held(kind, 'needs_sign_in'))).toBeUndefined();
  });

  it.each([
    ['claude', 'codex_oauth'],
    ['claude', 'openai_api_key'],
    ['claude', 'gateway'],
    ['openai', 'claude_oauth'],
    ['openai', 'anthropic_api_key'],
    ['openai', 'gateway'],
    ['claude', 'github_oauth'],
    ['openai', 'atlassian_api_token'],
  ] as const)('refuses a %s profile a %s subscription: another provider', (provider, kind) => {
    expect(credentialRefusal('subscription', provider, held(kind))).toMatchObject({
      ok: false,
      status: 422,
      code: 'provider_mismatch',
    });
  });

  it.each([
    ['github', 'github_oauth'],
    ['github', 'github_token'],
    ['atlassian', 'atlassian_api_token'],
  ] as const)('lets a profile’s %s part take a %s sign-in, never a revoked one', (part, kind) => {
    for (const provider of ['claude', 'openai'] as const) {
      expect(credentialRefusal(part, provider, held(kind))).toBeUndefined();
      expect(credentialRefusal(part, provider, held(kind, 'needs_sign_in'))).toBeUndefined();
    }
    const tool = part === 'github' ? 'GitHub' : 'Atlassian';
    expect(credentialRefusal(part, 'claude', held(kind, 'revoked'))).toMatchObject({
      code: 'credential_revoked',
      message: `A revoked ${tool} sign-in cannot be its ${tool} part; sign in again`,
    });
    expect(credentialRefusal(part, 'claude', undefined)).toMatchObject({
      code: 'credential_not_found',
      message: `No such ${tool} sign-in of yours for its ${tool} part`,
    });
  });

  it.each([
    ['github', 'atlassian_api_token'],
    ['github', 'claude_oauth'],
    ['github', 'gateway'],
    ['atlassian', 'github_token'],
    ['atlassian', 'openai_api_key'],
  ] as const)('refuses a profile’s %s part a %s: another kind', (part, kind) => {
    expect(credentialRefusal(part, 'claude', held(kind))).toMatchObject({
      status: 422,
      code: 'credential_kind_mismatch',
    });
  });

  it('names what a tool part takes when it refuses another kind', () => {
    expect(credentialRefusal('github', 'openai', held('claude_oauth'))?.message).toBe(
      "A profile's GitHub part takes a GitHub sign-in (github_oauth, github_token), not one of kind claude_oauth",
    );
    expect(credentialRefusal('atlassian', 'claude', held('github_oauth'))?.message).toBe(
      "A profile's Atlassian part takes an Atlassian sign-in (atlassian_api_token), not one of kind github_oauth",
    );
  });

  it('takes only a gateway as a gateway', () => {
    expect(credentialRefusal('gateway', 'claude', held('gateway'))).toBeUndefined();
    expect(credentialRefusal('gateway', 'claude', held('claude_oauth'))).toEqual({
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
    expect(credentialRefusal('gateway', 'claude', held('gateway', 'revoked'))).toMatchObject({
      status: 422,
      code: 'credential_revoked',
      message: expect.stringContaining('its gateway'),
    });
    expect(credentialRefusal('subscription', 'claude', held('openai_api_key', 'revoked'))).toEqual({
      ok: false,
      status: 422,
      code: 'provider_mismatch',
      message:
        'A Claude profile takes a Claude subscription (claude_oauth, claude_setup_token, anthropic_api_key), not one ' +
        'of kind openai_api_key',
    });
  });
});

describe('a universal gateway', () => {
  it('fits any profile, Claude or OpenAI, whatever an older gateway said its provider was', () => {
    for (const provider of ['claude', 'openai'] as const) {
      expect(credentialRefusal('gateway', provider, held('gateway'))).toBeUndefined();
    }
  });

  it('is still refused when revoked', () => {
    expect(credentialRefusal('gateway', 'openai', held('gateway', 'revoked'))).toMatchObject({
      code: 'credential_revoked',
    });
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

  it('lists the tool parts given a sign-in, and not one a part keeps', () => {
    const withGithub = { ...profile, githubCredentialId: 's1' };
    expect(
      partsPutIn(withGithub, {
        githubCredentialId: 's1',
        atlassianCredentialId: 's2',
        gatewayCredentialId: 'g1',
      }),
    ).toEqual([['atlassian', 's2']]);
    expect(partsPutIn(withGithub, { githubCredentialId: 's3', atlassianCredentialId: null })).toEqual([
      ['github', 's3'],
    ]);
  });
});

describe('profileChanges', () => {
  it('keeps only what differs: a name, a subscription or gateway changed or emptied, a model or effort', () => {
    expect(profileChanges(profile, { name: 'Work', credentialId: 'c1', model: 'claude-opus-5-5' })).toEqual(
      {},
    );
    expect(profileChanges(profile, { model: null, effort: 'max' })).toEqual({ model: null, effort: 'max' });
    expect(profileChanges(profile, {})).toEqual({});
    expect(profileChanges(profile, { name: 'Home', credentialId: null, gatewayCredentialId: 'g2' })).toEqual({
      name: 'Home',
      credentialId: null,
      gatewayCredentialId: 'g2',
    });
  });

  it('keeps a tool part’s rights only when they differ as jsonb, whatever their keys’ order', () => {
    const tool = { ...profile, githubRights: { repos: ['a/b'], push: true, pullRequests: false } };
    const same = { pullRequests: false, push: true, repos: ['a/b'] };
    expect(profileChanges(tool, { githubRights: same, atlassianRights: null })).toEqual({});
    const githubRights = { repos: 'all', push: true, pullRequests: false };
    expect(profileChanges(tool, { githubRights })).toEqual({ githubRights });
    expect(profileChanges(tool, { githubCredentialId: 's1', githubRights: null })).toEqual({
      githubCredentialId: 's1',
      githubRights: null,
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

  it('audits its owner, name, provider, credentials, model, effort and tool parts, nothing else', () => {
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
