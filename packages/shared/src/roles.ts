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

const ALL_ROLES: readonly MembershipRole[] = ['owner', 'admin', 'member', 'viewer'];
const BELOW_OWNER: readonly MembershipRole[] = ['admin', 'member', 'viewer'];

/**
 * The roles a member with role `actor` may give someone who holds `target` (the role they have now; for a newcomer,
 * an invitation, `viewer`): an owner any role to anyone; an admin admin, member or viewer to anyone but an owner;
 * a member or a viewer none. The server's role changes and invitations follow this rule
 * (`apps/server/src/modules/members/rules.ts`, held to it by its tests); the web offers only these roles.
 */
export function grantableRoles(actor: MembershipRole, target: MembershipRole): readonly MembershipRole[] {
  if (actor === 'owner') return ALL_ROLES;
  if (actor === 'admin' && target !== 'owner') return BELOW_OWNER;
  return [];
}

/**
 * Whether a member with role `actor` may remove someone who holds `target`: anyone may leave (`self`); an owner may
 * remove anyone, an admin anyone but an owner, a member or a viewer nobody else. The last-owner guard is the server's.
 */
export function mayRemove(actor: MembershipRole, target: MembershipRole, self: boolean): boolean {
  return self || actor === 'owner' || (actor === 'admin' && target !== 'owner');
}
