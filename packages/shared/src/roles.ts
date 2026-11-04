import type { MembershipRole } from './enums.ts';

/**
 * The role order of a membership (docs/architecture.md, "Identity flow"): owner > admin > member > viewer.
 * Each role may do everything the roles below it may; the server's `requireMembership(role)` and the web's
 * controls both read it from here.
 */
export const ROLE_RANK: Readonly<Record<MembershipRole, number>> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
};

/** True when `role` is `required` or above it. */
export function roleAtLeast(role: MembershipRole, required: MembershipRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}
