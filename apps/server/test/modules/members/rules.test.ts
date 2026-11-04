import type { MembershipRole } from '@mwc/shared/enums';
import { describe, expect, it } from 'vitest';
import {
  auditedRole,
  checkPair,
  daysLeft,
  invitationExpiry,
  inviteRefusal,
  LAST_OWNER,
  MEMBER_NOT_FOUND,
  type MemberState,
  normalizeEmail,
  removalRefusal,
  roleChangeRefusal,
  sameRole,
  storedStatuses,
  takesLastOwner,
} from '../../../src/modules/members/rules.ts';
import { ROLES } from '../../fixtures/members.ts';

const code = (refusal: { code: string } | undefined) => refusal?.code;

describe('roleChangeRefusal', () => {
  it('lets an owner give any role to anyone', () => {
    for (const target of ROLES)
      for (const next of ROLES) expect(roleChangeRefusal('owner', target, next)).toBeUndefined();
  });

  it('lets an admin move people among admin, member and viewer, never touching or making an owner', () => {
    const moves: MembershipRole[] = ['admin', 'member', 'viewer'];
    for (const target of moves)
      for (const next of moves) expect(roleChangeRefusal('admin', target, next)).toBeUndefined();
    for (const next of ROLES) {
      expect(roleChangeRefusal('admin', 'owner', next)?.message).toBe(
        "Only an owner may change an owner's role",
      );
    }
    for (const target of moves) {
      expect(roleChangeRefusal('admin', target, 'owner')?.message).toBe(
        'Only an owner may make someone an owner',
      );
    }
  });

  it('lets a member or a viewer change no role', () => {
    for (const actor of ['member', 'viewer'] as const) {
      for (const target of ROLES) {
        for (const next of ROLES) {
          expect(roleChangeRefusal(actor, target, next)).toEqual({
            ok: false,
            status: 403,
            code: 'forbidden',
            message: 'Only an owner or an admin may change roles',
          });
        }
      }
    }
  });
});

describe('removalRefusal', () => {
  it('lets anyone leave, an owner remove anyone and an admin anyone but an owner', () => {
    for (const actor of ROLES) expect(removalRefusal(actor, actor, true)).toBeUndefined();
    for (const target of ROLES) expect(removalRefusal('owner', target, false)).toBeUndefined();
    expect(ROLES.map((target) => code(removalRefusal('admin', target, false)))).toEqual([
      'forbidden',
      undefined,
      undefined,
      undefined,
    ]);
    for (const actor of ['member', 'viewer'] as const) {
      for (const target of ROLES) {
        expect(removalRefusal(actor, target, false)?.message).toBe(
          'Only an owner or an admin may remove someone else',
        );
      }
    }
  });
});

describe('takesLastOwner', () => {
  it('is true only for the last active owner losing the owner role or the membership', () => {
    const owner = { role: 'owner', status: 'active' } as const;
    for (const next of ['admin', 'member', 'viewer', 'removed'] as const) {
      expect(takesLastOwner(owner, next, 1)).toBe(true);
      expect(takesLastOwner(owner, next, 2)).toBe(false);
    }
    expect(takesLastOwner(owner, 'owner', 1)).toBe(false);
    expect(takesLastOwner({ role: 'owner', status: 'suspended' }, 'removed', 1)).toBe(false);
    expect(takesLastOwner({ role: 'admin', status: 'active' }, 'removed', 1)).toBe(false);
    expect(takesLastOwner(owner, 'removed', 0)).toBe(true);
    expect(LAST_OWNER).toMatchObject({ status: 409, code: 'last_owner' });
  });
});

describe('checkPair', () => {
  const active: MemberState = { role: 'admin', status: 'active' };
  it('passes two memberships on when the actor is active and the target is there and not removed', () => {
    for (const status of ['active', 'invited', 'suspended'] as const) {
      const target: MemberState = { role: 'member', status };
      expect(checkPair(active, target)).toEqual({ actor: active, target });
    }
  });

  it('refuses an actor who is no longer active (403) and a missing or removed target (404)', () => {
    for (const actor of [
      undefined,
      { ...active, status: 'removed' as const },
      { ...active, status: 'suspended' as const },
    ]) {
      expect(checkPair(actor, active)).toMatchObject({ status: 403, code: 'forbidden' });
    }
    expect(checkPair(active, undefined)).toBe(MEMBER_NOT_FOUND);
    expect(checkPair(active, { role: 'member', status: 'removed' })).toBe(MEMBER_NOT_FOUND);
  });
});

describe('sameRole and auditedRole', () => {
  it('see a change when either the role that applies or the granted role differs', () => {
    expect(sameRole({ role: 'member', grantedRole: 'member' }, 'member')).toBe(true);
    expect(sameRole({ role: 'admin', grantedRole: 'member' }, 'member')).toBe(false);
    expect(sameRole({ role: 'admin', grantedRole: 'member' }, 'admin')).toBe(false);
    expect(auditedRole({ role: 'admin', grantedRole: 'member', status: 'active' } as never)).toEqual({
      grantedRole: 'member',
      role: 'admin',
    });
  });
});

describe('invitation rules', () => {
  const now = new Date('2026-11-03T12:00:00.000Z');
  const DAY = 24 * 60 * 60 * 1000;

  it('normalizes an email, and lets an owner invite with any role and an admin with any but owner', () => {
    expect(normalizeEmail('  Bob@Example.TEST ')).toBe('bob@example.test');
    for (const role of ROLES) expect(inviteRefusal('owner', role)).toBeUndefined();
    for (const role of ['admin', 'member', 'viewer'] as const)
      expect(inviteRefusal('admin', role)).toBeUndefined();
    expect(inviteRefusal('admin', 'owner')).toMatchObject({ status: 403, code: 'forbidden' });
    for (const actor of ['member', 'viewer'] as const)
      expect(code(inviteRefusal(actor, 'viewer'))).toBe('forbidden');
  });

  it('expires an invitation 14 days after it is sent, and gives the provider the whole days left', () => {
    expect(invitationExpiry(now)).toEqual(new Date(now.getTime() + 14 * DAY));
    expect(daysLeft(invitationExpiry(now), now)).toBe(14);
    expect(daysLeft(new Date(now.getTime() + 13 * DAY + 1), now)).toBe(14);
    expect(daysLeft(new Date(now.getTime() + 1), now)).toBe(1);
    expect(daysLeft(new Date(now.getTime() - DAY), now)).toBe(1);
  });

  it('reads the stored statuses that can show as a filter (overdue pending ones show as expired)', () => {
    expect(storedStatuses('all')).toBeUndefined();
    expect(storedStatuses('pending')).toEqual(['pending']);
    expect(storedStatuses('expired')).toEqual(['pending', 'expired']);
    expect(storedStatuses('revoked')).toEqual(['revoked']);
  });
});
