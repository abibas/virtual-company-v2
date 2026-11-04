import { describe, expect, it } from 'vitest';
import { CLERK_ADMIN_ROLE, CLERK_MEMBER_ROLE, CLERK_ROLES } from '../src/roles.ts';

describe('CLERK_ROLES', () => {
  it('sends owners and admins as org:admin, members and viewers as org:member', () => {
    expect((['owner', 'admin', 'member', 'viewer'] as const).map(CLERK_ROLES.toProvider)).toEqual([
      CLERK_ADMIN_ROLE,
      CLERK_ADMIN_ROLE,
      CLERK_MEMBER_ROLE,
      CLERK_MEMBER_ROLE,
    ]);
  });

  it('reads org:admin as admin (never owner) and everything else as member', () => {
    expect(CLERK_ROLES.isAdmin('org:admin')).toBe(true);
    expect(CLERK_ROLES.isAdmin('org:member')).toBe(false);
    expect(CLERK_ROLES.isAdmin('admin')).toBe(false);
    expect(CLERK_ROLES.fromProvider('org:admin')).toBe('admin');
    expect(CLERK_ROLES.fromProvider('org:member')).toBe('member');
    expect(CLERK_ROLES.fromProvider('org:billing')).toBe('member');
  });
});
