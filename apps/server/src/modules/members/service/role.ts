import { diffFields, type Membership, type TenantDb } from '@mwc/db';
import type { MembershipRole } from '@mwc/shared/enums';
import { newId } from '@mwc/shared/ids';
import { enqueueOutbox, outboxKey } from '../../../platform/jobs/outbox.ts';
import { noticeMembership } from '../../notifications/service.ts';
import type { MembersRepo } from '../repo.ts';
import {
  auditedRole,
  checkPair,
  LAST_OWNER,
  type Refusal,
  roleChangeRefusal,
  sameRole,
  takesLastOwner,
} from '../rules.ts';

export interface RoleChange {
  /** The acting member's membership; the rest of it is read again under the company's lock. */
  readonly actorId: string;
  readonly membershipId: string;
  readonly role: MembershipRole;
  readonly requestId: string;
}

/**
 * Gives a member another role, local first, in one transaction under the company's lock: the acting member's and the
 * target's memberships are read as they are now (403 when the actor is no longer active, 404 for an unknown or
 * removed target), the role rules apply (403), a role the target has already is a no-op (200, nothing written), and
 * the last-owner guard refuses a change that leaves no active owner (409 `last_owner`). Then `role` and
 * `granted_role` both take the new role, with one audit row per changed field, the person's notice (S2.9) and the
 * outbox `update_role` call. Its
 * key is new for every change (a membership can change again later), and its handler pushes the role the membership
 * has when it runs, so calls run late or out of order still end on the latest role.
 */
export function changeRole(
  repo: MembersRepo,
  t: TenantDb,
  call: RoleChange,
): Promise<{ ok: true; membership: Membership } | Refusal> {
  return t.transaction(async (tx) => {
    const pair = checkPair(...(await repo.lockedPair(tx, call.actorId, call.membershipId)));
    if ('ok' in pair) return pair;
    const { actor, target } = pair;
    const refusal = roleChangeRefusal(actor.role, target.role, call.role);
    if (refusal) return refusal;
    if (sameRole(target, call.role)) return { ok: true as const, membership: target };
    if (takesLastOwner(target, call.role, await repo.activeOwners(tx))) return LAST_OWNER;
    const after = await repo.update(tx, target.id, { role: call.role, grantedRole: call.role });
    await repo.audit(tx, {
      actorKind: 'user',
      actorPrincipalId: actor.principalId,
      requestId: call.requestId,
      entityType: 'membership',
      entityId: target.id,
      action: 'update',
      changes: diffFields(auditedRole(target), auditedRole(after)),
    });
    await noticeMembership(tx, actor.principalId, target, after);
    await enqueueOutbox(tx, {
      op: 'update_role',
      idempotencyKey: outboxKey('update_role', target.id, newId()),
      payload: { membershipId: target.id, role: call.role },
    });
    return { ok: true as const, membership: after };
  });
}
