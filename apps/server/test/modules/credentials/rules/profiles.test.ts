import type { CredentialKind, CredentialStatus } from '@mwc/shared/enums';
import { describe, expect, it } from 'vitest';
import {
  auditedProfile,
  credentialRefusal,
  PART_COLUMNS,
  PROFILE_NOT_FOUND,
  partsPutIn,
  profileChanges,
  profileNameTaken,
} from '../../../../src/modules/credentials/rules/profiles.ts';

const profile = {
  name: 'Work',
  claudePart: true,
  claudeCredentialId: 'c1',
  claudeGatewayCredentialId: 'g1',
  claudeModel: 'claude-opus-5-5',
  claudeEffort: 'high' as const,
  openaiPart: false,
  openaiCredentialId: null,
  openaiGatewayCredentialId: null,
  openaiModel: null,
  openaiEffort: null,
  githubCredentialId: null,
  githubRights: null,
  atlassianCredentialId: null,
  atlassianRights: null,
};

/** A credential as the rules read it: its kind and its state. */
const held = (kind: CredentialKind, status: CredentialStatus = 'active') => ({ kind, status });
const subscription = (part: 'claude' | 'openai') => ({ part, role: 'subscription' }) as const;
const gateway = (part: 'claude' | 'openai') => ({ part, role: 'gateway' }) as const;
const signIn = (part: 'github' | 'atlassian') => ({ part, role: 'signIn' }) as const;

describe('credentialRefusal', () => {
  it.each([
    ['claude', 'claude_oauth'],
    ['claude', 'claude_setup_token'],
    ['claude', 'anthropic_api_key'],
    ['openai', 'codex_oauth'],
    ['openai', 'openai_api_key'],
  ] as const)('lets a %s part take an active or signed-out %s subscription', (part, kind) => {
    expect(credentialRefusal(subscription(part), held(kind))).toBeUndefined();
    expect(credentialRefusal(subscription(part), held(kind, 'needs_sign_in'))).toBeUndefined();
  });

  it.each([
    ['claude', 'codex_oauth'],
    ['claude', 'openai_api_key'],
    ['claude', 'gateway'],
    ['claude', 'github_oauth'],
    ['openai', 'claude_oauth'],
    ['openai', 'atlassian_api_token'],
  ] as const)('refuses a %s part a %s as its subscription: another kind', (part, kind) => {
    expect(credentialRefusal(subscription(part), held(kind))).toMatchObject({
      ok: false,
      status: 422,
      code: 'credential_kind_mismatch',
    });
  });

  it('names what each place takes when it refuses another kind', () => {
    expect(credentialRefusal(subscription('claude'), held('openai_api_key'))?.message).toBe(
      "A profile's Claude part takes a Claude subscription (claude_oauth, claude_setup_token, anthropic_api_key), not " +
        'one of kind openai_api_key',
    );
    expect(credentialRefusal(gateway('openai'), held('claude_oauth'))?.message).toBe(
      "A profile's gateway is a gateway, not one of kind claude_oauth",
    );
    expect(credentialRefusal(signIn('atlassian'), held('github_oauth'))?.message).toBe(
      "A profile's Atlassian part takes an Atlassian sign-in (atlassian_api_token), not one of kind github_oauth",
    );
  });

  it('takes any gateway in either AI part, never a revoked one', () => {
    for (const part of ['claude', 'openai'] as const) {
      expect(credentialRefusal(gateway(part), held('gateway'))).toBeUndefined();
    }
    expect(credentialRefusal(gateway('openai'), held('gateway', 'revoked'))).toMatchObject({
      code: 'credential_revoked',
      message: 'A revoked gateway cannot be in its OpenAI part; add it again',
    });
  });

  it.each([
    ['github', 'github_oauth'],
    ['github', 'github_token'],
    ['atlassian', 'atlassian_api_token'],
  ] as const)('lets a %s part take a %s sign-in, never a revoked one', (part, kind) => {
    expect(credentialRefusal(signIn(part), held(kind))).toBeUndefined();
    const tool = part === 'github' ? 'GitHub' : 'Atlassian';
    expect(credentialRefusal(signIn(part), held(kind, 'revoked'))).toMatchObject({
      code: 'credential_revoked',
      message: `A revoked ${tool} sign-in cannot be in its ${tool} part; sign in again`,
    });
  });

  it('refuses none of the owner’s, naming the place', () => {
    expect(credentialRefusal(subscription('openai'), undefined)).toEqual({
      ok: false,
      status: 422,
      code: 'credential_not_found',
      message: 'No such OpenAI subscription of yours for its OpenAI part',
    });
    expect(credentialRefusal(signIn('github'), undefined)?.message).toBe(
      'No such GitHub sign-in of yours for its GitHub part',
    );
  });
});

describe('partsPutIn', () => {
  it('lists the places given a credential the profile does not hold there yet', () => {
    expect(partsPutIn({}, { claudeCredentialId: 'c1', claudeGatewayCredentialId: null })).toEqual([
      [subscription('claude'), 'c1'],
    ]);
    expect(
      partsPutIn(profile, {
        claudeCredentialId: 'c2',
        openaiGatewayCredentialId: 'g2',
        githubCredentialId: 's1',
        atlassianCredentialId: null,
      }),
    ).toEqual([
      [subscription('claude'), 'c2'],
      [gateway('openai'), 'g2'],
      [signIn('github'), 's1'],
    ]);
    expect(partsPutIn(profile, { claudeCredentialId: 'c1' })).toEqual([]);
  });
});

describe('profileChanges', () => {
  it('keeps only what differs: a name, a part’s credentials, model or effort, its presence', () => {
    expect(
      profileChanges(profile, { name: 'Work', claudeCredentialId: 'c1', claudeModel: 'claude-opus-5-5' }),
    ).toEqual({});
    expect(profileChanges(profile, { claudeModel: null, claudeEffort: 'max', openaiPart: true })).toEqual({
      claudeModel: null,
      claudeEffort: 'max',
      openaiPart: true,
    });
    expect(profileChanges(profile, {})).toEqual({});
  });

  it('keeps a tool part’s rights only when they differ as jsonb, whatever their keys’ order', () => {
    const tool = { ...profile, githubRights: { repos: ['a/b'], push: true, pullRequests: false } };
    const same = { pullRequests: false, push: true, repos: ['a/b'] };
    expect(profileChanges(tool, { githubRights: same, atlassianRights: null })).toEqual({});
    const githubRights = { repos: 'all', push: true, pullRequests: false };
    expect(profileChanges(tool, { githubRights })).toEqual({ githubRights });
  });
});

describe('a profile’s refusals and audit fields', () => {
  it('answers another person’s profile as none and a taken name with 409', () => {
    expect(PROFILE_NOT_FOUND).toMatchObject({ status: 404, code: 'access_profile_not_found' });
    expect(profileNameTaken('Work')).toEqual({
      ok: false,
      status: 409,
      code: 'access_profile_name_taken',
      message: 'You have a profile named Work already',
    });
  });

  it('audits its owner, name and every column of its parts, nothing else', () => {
    const row = { ...profile, id: 'p1', ownerUserId: 'u1', createdAt: new Date(), updatedAt: new Date() };
    expect(auditedProfile(row)).toEqual({ ownerUserId: 'u1', ...profile });
    expect(PART_COLUMNS).toHaveLength(14);
  });
});
