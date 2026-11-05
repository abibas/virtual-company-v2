import type { Api } from '../../api/client.ts';
import type { ApiKey, Invitation, Me, Member, Membership } from '../../api/types.ts';
import type { Loaded } from '../../api/use-load.ts';
import { SAMPLE_NOW } from './sample.ts';

const days = (offset: number, hour = 10) => {
  const date = new Date(SAMPLE_NOW);
  date.setDate(date.getDate() + offset);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
};

export const SAMPLE_COMPANY = {
  id: '019a4f0c-8c1e-7c4b-9a52-3d1f2b6e7a10',
  name: 'Most Wanted',
  slug: 'most-wanted',
};
export const SAMPLE_ME = { id: 'u-ihor', email: 'ihor@example.com' };

/** The sample company as one of the person's memberships (what the shell and the switcher read). */
export const SAMPLE_MEMBERSHIP: Membership = {
  companyId: SAMPLE_COMPANY.id,
  slug: SAMPLE_COMPANY.slug,
  name: SAMPLE_COMPANY.name,
  role: 'owner',
  status: 'active',
  companyStatus: 'active',
  identityOrgId: 'org_sample',
};

/** `GET /api/me` for the gallery: the person with two companies, the sample one first. */
export const SAMPLE_SESSION: Me = {
  user: { id: SAMPLE_ME.id, email: SAMPLE_ME.email, displayName: 'Ihor Herasko', imageUrl: null },
  memberships: [
    SAMPLE_MEMBERSHIP,
    {
      companyId: '019a4f0c-8c1e-7c4b-9a52-3d1f2b6e7a11',
      slug: 'airia-platform',
      name: 'Airia Platform',
      role: 'admin',
      status: 'active',
      companyStatus: 'active',
      identityOrgId: 'org_sample_2',
    },
  ],
  session: { via: 'clerk', pending: false },
};

const person = (
  n: number,
  displayName: string,
  email: string,
  role: Member['role'],
  status: Member['status'],
  joined: number,
): Member => ({
  id: `m-${n}`,
  userId: n === 1 ? SAMPLE_ME.id : `u-${n}`,
  principalId: `p-${n}`,
  displayName,
  email,
  imageUrl: null,
  role,
  status,
  joinedAt: days(joined),
});

export const SAMPLE_MEMBERS: readonly Member[] = [
  person(1, 'Ihor Herasko', 'ihor@example.com', 'owner', 'active', -40),
  person(2, 'Olena Marsh', 'olena@example.com', 'admin', 'active', -21),
  person(3, 'Theo Laurent', 'theo@example.com', 'member', 'active', -2),
  person(4, 'Nadia Qureshi', 'nadia@example.com', 'viewer', 'suspended', -60),
];

const invitation = (
  n: number,
  email: string,
  role: Invitation['role'],
  sent: boolean,
  made: number,
): Invitation => ({
  id: `i-${n}`,
  email,
  role,
  status: 'pending',
  expiresAt: days(made + 14),
  sent,
  invitedByPrincipalId: 'p-1',
  acceptedByUserId: null,
  createdAt: days(made),
});

export const SAMPLE_INVITATIONS: readonly Invitation[] = [
  invitation(1, 'sam@example.com', 'member', true, -2),
  invitation(2, 'mira@example.com', 'admin', false, 0),
];

const key = (
  n: number,
  name: string,
  status: ApiKey['status'],
  made: number,
  used: number | null,
  owner?: Member,
): ApiKey => ({
  id: `k-${n}`,
  name,
  kind: 'personal',
  prefix: `mwc_pk_${['AbCd', 'Qr7x', 'Zz19'][n % 3]}`,
  scopes: [],
  status,
  createdAt: days(made),
  expiresAt: status === 'revoked' ? days(made + 90) : days(made + 90),
  lastUsedAt: used === null ? null : days(used, 18),
  revokedAt: status === 'revoked' ? days(-1) : null,
  ...(owner
    ? {
        owner: {
          principalId: owner.principalId,
          userId: owner.userId,
          displayName: owner.displayName,
          email: owner.email,
        },
      }
    : {}),
});

export const SAMPLE_KEYS: readonly ApiKey[] = [
  key(1, 'laptop', 'active', -8, -1),
  key(2, 'devbox', 'active', -30, null),
  key(3, 'old laptop', 'revoked', -80, -40),
];

export const SAMPLE_KEYS_EVERYONE: readonly ApiKey[] = [
  ...SAMPLE_KEYS.map((k) => ({ ...k, owner: ownerOf(SAMPLE_MEMBERS[0]) })),
  key(4, 'ci runner', 'active', -12, -1, SAMPLE_MEMBERS[1]),
  key(5, 'phone', 'expired', -120, -95, SAMPLE_MEMBERS[2]),
];

function ownerOf(member: Member | undefined): ApiKey['owner'] {
  if (!member) return undefined;
  return {
    principalId: member.principalId,
    userId: member.userId,
    displayName: member.displayName,
    email: member.email,
  };
}

/** A `useLoad` answer that has already arrived. */
export function loaded<T>(data: T): Loaded<T> {
  return { data, error: undefined, loading: false, reload: () => undefined };
}

/**
 * An API client whose every call fails: the page parts render their sample records, and an action (revoke, invite,
 * save) shows the app's own "could not be reached" refusal instead of changing anything.
 */
export function sampleApi(): Api {
  const handler: ProxyHandler<() => unknown> = {
    get: () => new Proxy(() => undefined, handler),
    apply: () => Promise.reject(new Error('Sample data: nothing is saved here')),
  };
  return new Proxy(() => undefined, handler) as unknown as Api;
}
