import { describe, expect, it } from 'vitest';
import { MembershipRole } from '../src/enums.ts';
import { grantableRoles, mayRemove, ROLE_RANK, roleAtLeast } from '../src/roles.ts';

describe('roleAtLeast', () => {
  it('ranks every membership role, owner highest and viewer lowest', () => {
    expect(Object.keys(ROLE_RANK).sort()).toEqual([...MembershipRole.options].sort());
    const ordered = [...MembershipRole.options].sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a]);
    expect(ordered).toEqual(['owner', 'admin', 'member', 'viewer']);
  });

  it.each([
    ['owner', 'admin', true],
    ['admin', 'admin', true],
    ['member', 'admin', false],
    ['viewer', 'member', false],
    ['viewer', 'viewer', true],
    ['admin', 'owner', false],
    ['owner', 'viewer', true],
  ] as const)('%s meets %s: %s', (role, required, expected) => {
    expect(roleAtLeast(role, required)).toBe(expected);
  });
});

describe('grantableRoles', () => {
  it('lets an owner give any role to anyone', () => {
    for (const target of MembershipRole.options)
      expect(grantableRoles('owner', target)).toEqual(['owner', 'admin', 'member', 'viewer']);
  });

  it('lets an admin give admin, member or viewer to anyone but an owner', () => {
    for (const target of ['admin', 'member', 'viewer'] as const)
      expect(grantableRoles('admin', target)).toEqual(['admin', 'member', 'viewer']);
    expect(grantableRoles('admin', 'owner')).toEqual([]);
  });

  it('gives members and viewers no role to grant', () => {
    for (const actor of ['member', 'viewer'] as const)
      for (const target of MembershipRole.options) expect(grantableRoles(actor, target)).toEqual([]);
  });
});

describe('mayRemove', () => {
  it.each([
    ['owner', 'owner', false, true],
    ['admin', 'owner', false, false],
    ['admin', 'admin', false, true],
    ['admin', 'viewer', false, true],
    ['member', 'viewer', false, false],
    ['viewer', 'viewer', false, false],
    ['viewer', 'viewer', true, true],
    ['admin', 'owner', true, true],
  ] as const)('%s removing %s (self: %s): %s', (actor, target, self, expected) => {
    expect(mayRemove(actor, target, self)).toBe(expected);
  });
});
