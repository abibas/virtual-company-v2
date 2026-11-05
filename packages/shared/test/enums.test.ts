import { describe, expect, it } from 'vitest';
import {
  ActorKind,
  AgentStatus,
  ApiKeyKind,
  CompanyStatus,
  Effort,
  Harness,
  IdentityEventStatus,
  IdentityEventType,
  IdentityInboxType,
  IdentityOutboxOp,
  IdentityOutboxStatus,
  InvitationStatus,
  LogoContentType,
  MembershipRole,
  MembershipStatus,
  PrincipalKind,
  UserStatus,
} from '../src/enums.ts';
import * as identity from '../src/identity.ts';

describe('enums', () => {
  it('lists the values the database CHECK constraints allow', () => {
    expect(CompanyStatus.options).toEqual(['provisioning', 'active', 'suspended', 'deleted']);
    expect(UserStatus.options).toEqual(['active', 'deactivated']);
    expect(ActorKind.options).toEqual(['user', 'agent', 'system', 'identity']);
    expect(PrincipalKind.options).toEqual(['person', 'agent']);
    expect(ApiKeyKind.options).toEqual(['personal', 'runner', 'scim']);
    expect(IdentityEventStatus.options).toEqual(['pending', 'processed', 'failed']);
    expect(IdentityInboxType.options).toEqual([...IdentityEventType.options, 'ignored']);
    expect(IdentityOutboxOp.options).toEqual([
      'create_org',
      'invite',
      'revoke_invite',
      'update_role',
      'remove_member',
      'delete_org',
    ]);
    expect(IdentityOutboxStatus.options).toEqual(['pending', 'done', 'failed']);
    expect(LogoContentType.options).toEqual(['image/png', 'image/jpeg', 'image/webp']);
    expect(AgentStatus.options).toEqual(['active', 'paused', 'archived']);
    expect(Harness.options).toEqual(['claude_code', 'codex']);
    expect(Effort.options).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('accepts known values and rejects others', () => {
    expect(CompanyStatus.parse('active')).toBe('active');
    expect(UserStatus.safeParse('banned').success).toBe(false);
    expect(ActorKind.safeParse('User').success).toBe(false);
    expect(PrincipalKind.safeParse('robot').success).toBe(false);
    expect(AgentStatus.parse('paused')).toBe('paused');
    expect(Harness.safeParse('cursor').success).toBe(false);
    expect(Effort.safeParse('XHIGH').success).toBe(false);
  });

  it('are the same objects the identity contracts export', () => {
    expect(identity.MembershipRole).toBe(MembershipRole);
    expect(identity.MembershipStatus).toBe(MembershipStatus);
    expect(identity.InvitationStatus).toBe(InvitationStatus);
    expect(identity.IdentityEventType).toBe(IdentityEventType);
    expect(identity.IdentityInboxType).toBe(IdentityInboxType);
    expect(identity.IDENTITY_EVENT_TYPES).toEqual(IdentityEventType.options);
  });
});
