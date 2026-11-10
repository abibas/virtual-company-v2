import type { Agent } from '@mwc/db';
import { describe, expect, it } from 'vitest';
import {
  agentChanges,
  auditedAgent,
  chooseSlug,
  defaultProviderMismatch,
  giveRefusal,
  profileClearedMessage,
  profileHarnessMismatch,
  profileStep,
  statusMove,
} from '../../../../src/modules/org/rules/agents.ts';

const agent: Agent = {
  id: 'a1',
  companyId: 'c1',
  principalId: 'p1',
  name: 'SLOP BOX',
  slug: 'slop-box',
  roleTitle: 'Coder',
  status: 'active',
  harness: 'claude_code',
  instructions: 'v1',
  instructionsRev: 4,
  maxConcurrentRuns: 1,
  face: 9,
  settings: {},
  profileId: null,
  createdAt: new Date('2026-11-05T10:00:00Z'),
  updatedAt: new Date('2026-11-05T10:00:00Z'),
};

describe('chooseSlug', () => {
  it('keeps a chosen slug that is free and refuses one that is taken', () => {
    expect(chooseSlug('Whatever', 'mine', new Set(['other']))).toBe('mine');
    expect(chooseSlug('Whatever', 'other', new Set(['other']))).toMatchObject({
      ok: false,
      status: 409,
      code: 'agent_slug_taken',
    });
  });

  it('derives the first free slug from the name: the name’s own, then -2, -3, ...', () => {
    expect(chooseSlug('SLOP BOX', undefined, new Set())).toBe('slop-box');
    expect(chooseSlug('SLOP BOX', undefined, new Set(['slop-box', 'slop-box-2', 'slop-box-4']))).toBe(
      'slop-box-3',
    );
    expect(chooseSlug('日本', undefined, new Set(['agent']))).toBe('agent-2');
    const long = 'x'.repeat(63);
    expect(chooseSlug(long, undefined, new Set([long]))).toBe(`${'x'.repeat(61)}-2`);
  });
});

describe('statusMove', () => {
  it('archives into archived, restores out of it, and moves nothing otherwise', () => {
    expect(statusMove('active', 'archived')).toBe('archive');
    expect(statusMove('paused', 'archived')).toBe('archive');
    expect(statusMove('archived', 'active')).toBe('restore');
    expect(statusMove('archived', 'paused')).toBe('restore');
    expect(statusMove('active', 'paused')).toBe('none');
    expect(statusMove('paused', 'active')).toBe('none');
    expect(statusMove('archived', 'archived')).toBe('none');
    expect(statusMove('active', undefined)).toBe('none');
  });
});

describe('agentChanges', () => {
  it('keeps only the fields that differ, and bumps instructionsRev with new instructions', () => {
    expect(agentChanges(agent, { name: 'SLOP BOX', face: 9, instructions: 'v1' })).toEqual({});
    expect(
      agentChanges(agent, { name: 'New', harness: 'codex', status: 'paused', maxConcurrentRuns: 3 }),
    ).toEqual({
      name: 'New',
      harness: 'codex',
      status: 'paused',
      maxConcurrentRuns: 3,
    });
    expect(agentChanges(agent, { instructions: 'v2' })).toEqual({ instructions: 'v2', instructionsRev: 5 });
    expect(agentChanges(agent, { instructions: '', face: 0 })).toEqual({
      instructions: '',
      instructionsRev: 5,
      face: 0,
    });
  });
});

describe('auditedAgent', () => {
  it('follows the instructions by their revision, never their text', () => {
    const audited = auditedAgent(agent);
    expect(audited).toEqual({
      principalId: 'p1',
      name: 'SLOP BOX',
      slug: 'slop-box',
      roleTitle: 'Coder',
      status: 'active',
      harness: 'claude_code',
      instructionsRev: 4,
      maxConcurrentRuns: 1,
      face: 9,
      profileId: null,
    });
    expect(audited).not.toHaveProperty('instructions');
    expect(auditedAgent({ ...agent, profileId: 'pr1' }).profileId).toBe('pr1');
  });
});

describe('giveRefusal', () => {
  const owner = { userId: 'u1', role: 'admin', session: true } as const;

  it('lets only the owner give their profile, signed in, as an admin or an owner', () => {
    expect(giveRefusal(owner, 'u1')).toBeUndefined();
    expect(giveRefusal({ ...owner, role: 'owner' }, 'u1')).toBeUndefined();
  });

  it.each([
    ['someone else’s profile', owner, 'u2', 403, 'profile_not_yours'],
    ['no such profile', owner, undefined, 422, 'profile_not_found'],
    ['an API key', { ...owner, session: false }, 'u1', 403, 'session_required'],
    ['a member', { ...owner, role: 'member' }, 'u1', 403, 'forbidden'],
    ['a viewer', { ...owner, role: 'viewer' }, 'u1', 403, 'forbidden'],
  ] as const)('refuses %s', (_, giver, ownerUserId, status, code) => {
    expect(giveRefusal(giver, ownerUserId)).toMatchObject({ ok: false, status, code });
  });

  it('asks for the session first, then the role, then the profile', () => {
    const keyMember = { userId: 'u1', role: 'member', session: false } as const;
    expect(giveRefusal(keyMember, undefined)).toMatchObject({ code: 'session_required' });
    expect(giveRefusal({ ...keyMember, session: true }, 'u2')).toMatchObject({ code: 'forbidden' });
  });
});

describe('profileStep', () => {
  it('gives a new profile, takes one off with null, and does nothing for the same one or none asked', () => {
    expect(profileStep(null, 'p1')).toBe('give');
    expect(profileStep('p1', 'p2')).toBe('give');
    expect(profileStep('p1', null)).toBe('remove');
    expect(profileStep('p1', 'p1')).toBe('none');
    expect(profileStep(null, null)).toBe('none');
    expect(profileStep('p1', undefined)).toBe('none');
  });
});

describe('which profiles fit', () => {
  it('names the profile an agent on each harness needs, and the one a default of each provider takes', () => {
    expect(profileHarnessMismatch('openai', 'claude_code')).toEqual({
      ok: false,
      status: 422,
      code: 'profile_harness_mismatch',
      message: 'A Claude Code agent needs a Claude profile; this access profile is for OpenAI',
    });
    expect(profileHarnessMismatch('claude', 'codex').message).toBe(
      'A Codex agent needs an OpenAI profile; this access profile is for Claude',
    );
    expect(defaultProviderMismatch('claude', 'openai')).toMatchObject({
      status: 422,
      code: 'provider_mismatch',
      message: 'Your OpenAI default is an OpenAI profile; this access profile is for Claude',
    });
    expect(profileClearedMessage('Home', 'openai', 'claude_code')).toBe(
      'Its access profile Home is for OpenAI, so it was taken off: a Claude Code agent needs a Claude profile',
    );
  });
});
