import { describe, expect, it } from 'vitest';
import { MembershipRole } from '../src/enums.ts';
import { ROLE_RANK, roleAtLeast } from '../src/roles.ts';

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
