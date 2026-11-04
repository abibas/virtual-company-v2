import { ClerkAPIResponseError } from '@clerk/backend/errors';
import { vi } from 'vitest';
import type {
  ClerkBackend,
  ClerkBackendApi,
  ClerkInvitationData,
  ClerkMembershipData,
  ClerkOrganizationData,
  ClerkUserData,
  Page,
} from '../../src/backend/client.ts';
import { ClerkIdentityProvider, type ClerkIdentityProviderOptions } from '../../src/provider.ts';

/** The issuer of the test instance (no network: everything goes through the fake backend). */
export const ISSUER = 'https://test-instance.clerk.accounts.dev';
/** Not a real key: the shape Clerk checks, nothing more. */
export const SECRET_KEY = `sk_test_${'0'.repeat(40)}`;
export const T0 = 1_780_000_000_000;

function unstubbed(name: string) {
  return vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => {
    throw new Error(`fake Clerk: ${name} was not stubbed`);
  });
}

/** A fake of the Backend API: every method a `vi.fn` that fails until a test stubs it. */
export function fakeApi() {
  return {
    users: { getUser: unstubbed('getUser'), getOrganizationMembershipList: unstubbed('users.memberships') },
    organizations: {
      createOrganization: unstubbed('createOrganization'),
      getOrganizationList: unstubbed('getOrganizationList'),
      deleteOrganization: unstubbed('deleteOrganization'),
      getOrganizationMembershipList: unstubbed('getOrganizationMembershipList'),
      updateOrganizationMembership: unstubbed('updateOrganizationMembership'),
      deleteOrganizationMembership: unstubbed('deleteOrganizationMembership'),
      createOrganizationInvitation: unstubbed('createOrganizationInvitation'),
      getOrganizationInvitation: unstubbed('getOrganizationInvitation'),
      revokeOrganizationInvitation: unstubbed('revokeOrganizationInvitation'),
      getOrganizationInvitationList: unstubbed('getOrganizationInvitationList'),
    },
  };
}

export type FakeApi = ReturnType<typeof fakeApi>;

/** A connector over a fake backend, with a clock the test moves. */
export function clerkWorld(options: Partial<ClerkIdentityProviderOptions> = {}) {
  const api = fakeApi();
  let now = T0;
  const backend: ClerkBackend = {
    api: api as unknown as ClerkBackendApi,
    verifyToken: vi.fn(async () => ({})),
    verifyWebhook: vi.fn(async () => ({ type: 'unused', data: {} })),
  };
  const provider = new ClerkIdentityProvider({
    backend,
    issuer: ISSUER,
    secretKey: SECRET_KEY,
    now: () => now,
    ...options,
  });
  return {
    api,
    backend,
    provider,
    advance(ms: number) {
      now += ms;
    },
  };
}

/** A Backend API error as the SDK throws it (`ClerkAPIResponseError`); no status means no response. */
export function apiError(status: number | undefined, code = '', retryAfter?: number): ClerkAPIResponseError {
  return new ClerkAPIResponseError('fake failure', {
    data: code ? [{ code, message: `${code} message`, long_message: `${code} long message` }] : [],
    // The SDK leaves the status out when no response came back (a network error).
    status: status as number,
    ...(retryAfter === undefined ? {} : { retryAfter }),
  });
}

export function page<T>(data: T[], totalCount = data.length): Page<T> {
  return { data, totalCount };
}

export function clerkUser(overrides: Partial<ClerkUserData> = {}): ClerkUserData {
  return {
    id: 'user_1',
    firstName: 'Ann',
    lastName: 'Lee',
    username: null,
    imageUrl: 'https://img.clerk.com/ann',
    hasImage: true,
    primaryEmailAddressId: 'idn_1',
    emailAddresses: [
      { id: 'idn_0', emailAddress: 'old@x.test' },
      { id: 'idn_1', emailAddress: 'Ann@X.Test' },
    ],
    updatedAt: T0,
    ...overrides,
  };
}

export function clerkOrg(overrides: Partial<ClerkOrganizationData> = {}): ClerkOrganizationData {
  return {
    id: 'org_1',
    name: 'Acme',
    slug: 'acme',
    privateMetadata: { mwc_company_id: 'c1' },
    updatedAt: T0,
    ...overrides,
  };
}

export function clerkMembership(overrides: Partial<ClerkMembershipData> = {}): ClerkMembershipData {
  return {
    id: 'orgmem_1',
    role: 'org:member',
    privateMetadata: { mwc_invitation_id: 'inv-1' },
    updatedAt: T0,
    organization: clerkOrg(),
    publicUserData: { userId: 'user_1' },
    ...overrides,
  };
}

export function clerkInvitation(overrides: Partial<ClerkInvitationData> = {}): ClerkInvitationData {
  return {
    id: 'orginv_1',
    emailAddress: 'Two@X.Test',
    role: 'org:member',
    organizationId: 'org_1',
    status: 'pending',
    privateMetadata: { mwc_invitation_id: 'inv-1', mwc_company_id: 'c1' },
    expiresAt: T0 + 14 * 86_400_000,
    updatedAt: T0,
    url: null,
    ...overrides,
  };
}
