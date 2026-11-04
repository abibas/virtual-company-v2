import type { MembershipRole, MembershipStatus } from '@mwc/shared/enums';

/** A refusal the routes answer in the common error shape. */
export interface Refusal {
  readonly ok: false;
  readonly status: 403 | 404 | 409;
  readonly code: string;
  readonly message: string;
}

export const refuse = (status: Refusal['status'], code: string, message: string): Refusal => ({
  ok: false,
  status,
  code,
  message,
});

export const MEMBER_NOT_FOUND = refuse(404, 'member_not_found', 'No such member in this company');
export const LAST_OWNER = refuse(409, 'last_owner', 'The company must keep at least one active owner');

/** The membership fields the rules read. */
export interface MemberState {
  readonly role: MembershipRole;
  readonly status: MembershipStatus;
}

/**
 * The two memberships a role change or a removal reads under the company's lock, or why it stops: the acting member
 * is no longer active (403: their own role changed or they were removed meanwhile), or the target is unknown or
 * removed (404).
 */
export function checkPair<T extends MemberState>(
  actor: T | undefined,
  target: T | undefined,
): Refusal | { readonly actor: T; readonly target: T } {
  if (actor?.status !== 'active') {
    return refuse(403, 'forbidden', 'You are no longer an active member of this company');
  }
  if (target === undefined || target.status === 'removed') return MEMBER_NOT_FOUND;
  return { actor, target };
}

/**
 * Why `actor` may not give `target` the role `next`, or undefined when it may: an owner may give any role to
 * anyone; an admin may move people among admin, member and viewer, but never touch an owner or make one; a member
 * or a viewer changes no roles.
 */
export function roleChangeRefusal(
  actor: MembershipRole,
  target: MembershipRole,
  next: MembershipRole,
): Refusal | undefined {
  if (actor === 'owner') return undefined;
  if (actor !== 'admin') return refuse(403, 'forbidden', 'Only an owner or an admin may change roles');
  if (target === 'owner') return refuse(403, 'forbidden', "Only an owner may change an owner's role");
  if (next === 'owner') return refuse(403, 'forbidden', 'Only an owner may make someone an owner');
  return undefined;
}

/**
 * Why `actor` may not remove `target`, or undefined when it may: anyone may remove themselves (leave); an owner
 * may remove anyone; an admin anyone but an owner; a member or a viewer nobody else.
 */
export function removalRefusal(
  actor: MembershipRole,
  target: MembershipRole,
  self: boolean,
): Refusal | undefined {
  if (self || actor === 'owner') return undefined;
  if (actor !== 'admin') return refuse(403, 'forbidden', 'Only an owner or an admin may remove someone else');
  if (target === 'owner') return refuse(403, 'forbidden', 'Only an owner may remove an owner');
  return undefined;
}

/**
 * The last-owner guard: true when giving `target` the role `next` (or removing them, `next = 'removed'`) would leave
 * the company with no active owner, `activeOwners` being the count before the change.
 */
export function takesLastOwner(
  target: MemberState,
  next: MembershipRole | 'removed',
  activeOwners: number,
): boolean {
  return target.status === 'active' && target.role === 'owner' && next !== 'owner' && activeOwners <= 1;
}

/** A role change that changes nothing: the role that applies and the role granted here are both `next` already. */
export function sameRole(
  target: { readonly role: MembershipRole; readonly grantedRole: MembershipRole },
  next: MembershipRole,
) {
  return target.role === next && target.grantedRole === next;
}

/** The membership fields a role change audits. */
export function auditedRole(row: { readonly role: MembershipRole; readonly grantedRole: MembershipRole }) {
  return { grantedRole: row.grantedRole, role: row.role };
}
