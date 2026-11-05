import type { Agent } from '@mwc/db';
import { describe, expect, it } from 'vitest';
import {
  agentChanges,
  auditedAgent,
  chooseSlug,
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
  model: 'claude-opus-5-5',
  effort: 'high',
  instructions: 'v1',
  instructionsRev: 4,
  maxConcurrentRuns: 1,
  face: 9,
  settings: {},
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
      agentChanges(agent, { name: 'New', effort: 'max', status: 'paused', maxConcurrentRuns: 3 }),
    ).toEqual({
      name: 'New',
      effort: 'max',
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
      model: 'claude-opus-5-5',
      effort: 'high',
      instructionsRev: 4,
      maxConcurrentRuns: 1,
      face: 9,
    });
    expect(audited).not.toHaveProperty('instructions');
  });
});
