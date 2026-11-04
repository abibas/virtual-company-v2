import type { ProviderRoleMap } from '@mwc/identity-core';
import type { MembershipRole } from '@mwc/shared/identity';

/** Clerk's two default organization roles. */
export const CLERK_ADMIN_ROLE = 'org:admin';
export const CLERK_MEMBER_ROLE = 'org:member';

export interface ClerkRoleMap extends ProviderRoleMap {
  /**
   * Our reading of a Clerk role: `org:admin` is admin (never owner: only a local decision makes an owner),
   * anything else member. Informational; the projector applies roles with `isAdmin` and our grant.
   */
  fromProvider(providerRole: string): Extract<MembershipRole, 'admin' | 'member'>;
}

/**
 * Outbound: owner and admin are `org:admin`, member and viewer `org:member` (Clerk has no viewer and no
 * owner). Inbound: `org:admin` is admin-like, so a promotion in Clerk promotes here; nothing else is.
 */
export const CLERK_ROLES: ClerkRoleMap = {
  toProvider: (role) => (role === 'owner' || role === 'admin' ? CLERK_ADMIN_ROLE : CLERK_MEMBER_ROLE),
  isAdmin: (providerRole) => providerRole === CLERK_ADMIN_ROLE,
  fromProvider: (providerRole) => (providerRole === CLERK_ADMIN_ROLE ? 'admin' : 'member'),
};
