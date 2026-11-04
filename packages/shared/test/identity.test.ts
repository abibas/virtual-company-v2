import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  EpochMs,
  ExternalInvitation,
  ExternalInvitationStatus,
  ExternalMembership,
  ExternalOrg,
  ExternalUser,
  IDENTITY_EVENT_TYPES,
  IDENTITY_METADATA,
  IdentityMetadata,
  InvitationStatus,
  MembershipRole,
  MembershipStatus,
  NormalizedIdentityEvent,
  VerifiedIdentity,
} from '../src/identity.ts';

const membership = {
  orgExternalId: 'org_1',
  subject: 'user_1',
  externalMembershipId: 'orgmem_1',
  providerRole: 'org:member',
  metadata: { [IDENTITY_METADATA.invitationId]: 'inv-1' },
  updatedAt: 1_762_171_200_000,
};

describe('identity enums', () => {
  it('hold exactly the values the database CHECKs will use', () => {
    expect(MembershipRole.options).toEqual(['owner', 'admin', 'member', 'viewer']);
    expect(MembershipStatus.options).toEqual(['invited', 'active', 'suspended', 'removed']);
    expect(InvitationStatus.options).toEqual(['pending', 'accepted', 'revoked', 'expired', 'failed']);
  });
});

describe('NormalizedIdentityEvent', () => {
  it('parses each type with its data shape', () => {
    const event = {
      provider: 'clerk',
      externalEventId: 'msg_1',
      occurredAt: 1_762_171_200_001,
      type: 'membership.upserted',
      data: membership,
    };
    expect(NormalizedIdentityEvent.parse(event)).toEqual(event);
    const deleted = { ...event, type: 'user.deleted', data: { subject: 'user_1' } };
    expect(NormalizedIdentityEvent.parse(deleted)).toEqual(deleted);
  });

  it('refuses an unknown type, a data shape of another type, and a fractional time', () => {
    const base = { provider: 'clerk', externalEventId: 'msg_1', occurredAt: 1 };
    expect(NormalizedIdentityEvent.safeParse({ ...base, type: 'user.renamed', data: {} }).success).toBe(
      false,
    );
    expect(
      NormalizedIdentityEvent.safeParse({ ...base, type: 'user.upserted', data: membership }).success,
    ).toBe(false);
    expect(
      NormalizedIdentityEvent.safeParse({
        ...base,
        occurredAt: 1.5,
        type: 'user.deleted',
        data: { subject: 'x' },
      }).success,
    ).toBe(false);
  });

  it('lists every type in IDENTITY_EVENT_TYPES', () => {
    const types = NormalizedIdentityEvent.options.map((option) => [...option.shape.type.values][0]);
    expect(types).toEqual([...IDENTITY_EVENT_TYPES]);
  });
});

describe('ExternalMembership and VerifiedIdentity', () => {
  it('keep the optional provider invitation id and session fields optional', () => {
    expect(ExternalMembership.parse(membership).externalInvitationId).toBeUndefined();
    expect(
      ExternalMembership.parse({ ...membership, externalInvitationId: 'orginv_1' }).externalInvitationId,
    ).toBe('orginv_1');
    expect(VerifiedIdentity.parse({ issuer: 'https://i', subject: 's', pending: false })).toEqual({
      issuer: 'https://i',
      subject: 's',
      pending: false,
    });
    expect(VerifiedIdentity.safeParse({ issuer: '', subject: 's', pending: false }).success).toBe(false);
  });
});

const T = 1_762_171_200_000;
const user = { subject: 'user_1', primaryEmail: 'ann@x.test', displayName: 'Ann', updatedAt: T };
const org = { externalId: 'org_1', name: 'Acme', metadata: { mwc_company_id: 'c1' }, updatedAt: T };
const invitation = {
  externalId: 'orginv_1',
  orgExternalId: 'org_1',
  email: 'bob@x.test',
  providerRole: 'org:member',
  status: 'pending',
  metadata: {},
  updatedAt: T,
};

/** Each contract with values it must accept and values it must refuse. */
const contracts: [string, z.ZodType, unknown[], unknown[]][] = [
  ['MembershipRole', MembershipRole, ['owner', 'viewer'], ['Owner', 'guest', '', null]],
  ['MembershipStatus', MembershipStatus, ['invited', 'removed'], ['deleted', 'pending']],
  ['InvitationStatus', InvitationStatus, ['pending', 'failed'], ['active', 'cancelled']],
  ['ExternalInvitationStatus', ExternalInvitationStatus, ['pending', 'expired'], ['failed', 'declined']],
  ['EpochMs', EpochMs, [0, T], [-1, 1.5, '1762171200000', Number.NaN]],
  ['IdentityMetadata', IdentityMetadata, [{}, { a: 1, b: { c: [true] } }], [null, [], 'x']],
  [
    'VerifiedIdentity',
    VerifiedIdentity,
    [
      { issuer: 'https://i', subject: 's', pending: false },
      { issuer: 'https://i', subject: 's', sessionId: 'sess_1', pending: true, activeOrgExternalId: 'org_1' },
    ],
    [
      { issuer: 'https://i', subject: '', pending: false },
      { issuer: 'https://i', subject: 's' },
      { issuer: 'https://i', subject: 's', pending: false, sessionId: '' },
      { issuer: 'https://i', subject: 's', pending: false, activeOrgExternalId: '' },
    ],
  ],
  [
    'ExternalUser',
    ExternalUser,
    [user, { ...user, displayName: '', imageUrl: 'https://img.test/a.png' }],
    [
      { ...user, primaryEmail: 'not-an-email' },
      { ...user, imageUrl: 'not a url' },
      { ...user, subject: '' },
      { ...user, updatedAt: undefined },
    ],
  ],
  [
    'ExternalOrg',
    ExternalOrg,
    [org, { ...org, slug: 'acme', metadata: {} }],
    [
      { ...org, externalId: '' },
      { ...org, metadata: undefined },
      { ...org, updatedAt: -5 },
    ],
  ],
  [
    'ExternalMembership',
    ExternalMembership,
    [membership, { ...membership, metadata: {}, externalInvitationId: 'orginv_1' }],
    [
      { ...membership, providerRole: '' },
      { ...membership, externalMembershipId: undefined },
      { ...membership, externalInvitationId: '' },
      { ...membership, metadata: 'inv-1' },
    ],
  ],
  [
    'ExternalInvitation',
    ExternalInvitation,
    [
      invitation,
      { ...invitation, status: 'accepted', metadata: { mwc_invitation_id: 'inv-1' }, expiresAt: T + 1 },
    ],
    [
      { ...invitation, status: 'failed' },
      { ...invitation, email: 'bob' },
      { ...invitation, orgExternalId: '' },
      { ...invitation, expiresAt: 1.5 },
    ],
  ],
];

describe('identity contracts', () => {
  it.each(contracts)(
    '%s accepts its valid values and refuses the others',
    (_name, schema, valid, invalid) => {
      for (const value of valid)
        expect(schema.safeParse(value), JSON.stringify(value)).toMatchObject({ success: true });
      for (const value of invalid) {
        expect(schema.safeParse(value).success, JSON.stringify(value) ?? String(value)).toBe(false);
      }
    },
  );

  it('strips fields a contract does not know', () => {
    expect(ExternalUser.parse({ ...user, password: 'x' })).toEqual(user);
  });
});

describe('NormalizedIdentityEvent per type', () => {
  const base = { provider: 'fake', externalEventId: 'evt_1', occurredAt: T };
  const data: Record<(typeof IDENTITY_EVENT_TYPES)[number], unknown> = {
    'user.upserted': user,
    'user.deleted': { subject: 'user_1' },
    'org.upserted': org,
    'org.deleted': { externalId: 'org_1' },
    'membership.upserted': membership,
    'membership.deleted': { orgExternalId: 'org_1', subject: 'user_1', externalMembershipId: 'orgmem_1' },
    'invitation.accepted': { ...invitation, status: 'accepted' },
    'invitation.revoked': { ...invitation, status: 'revoked' },
  };

  it.each(IDENTITY_EVENT_TYPES)('parses %s and refuses it with empty data', (type) => {
    const event = { ...base, type, data: data[type] };
    expect(NormalizedIdentityEvent.parse(event)).toEqual(event);
    expect(NormalizedIdentityEvent.safeParse({ ...event, data: {} }).success).toBe(false);
  });

  it('refuses an event without a provider or a delivery id', () => {
    const event = { ...base, type: 'user.deleted', data: { subject: 's' } };
    expect(NormalizedIdentityEvent.safeParse({ ...event, provider: '' }).success).toBe(false);
    expect(NormalizedIdentityEvent.safeParse({ ...event, externalEventId: undefined }).success).toBe(false);
  });
});
