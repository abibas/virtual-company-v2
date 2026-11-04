import { diffFields, type TenantDb } from '@mwc/db';
import { newId } from '@mwc/shared/ids';
import { enqueueOutbox, outboxKey } from '../../../platform/jobs/outbox.ts';
import type { MembersRepo } from '../repo.ts';
import { checkPair, LAST_OWNER, type Refusal, removalRefusal, takesLastOwner } from '../rules.ts';

export interface Removal {
  /** The acting member's membership; the rest of it is read again under the company's lock. */
  readonly actorId: string;
  readonly membershipId: string;
  readonly requestId: string;
  readonly now: Date;
}

/**
 * Removes a member, local first, so their access ends with this transaction: under the company's lock the two
 * memberships are read as they are now (403 when the actor is no longer active, 404 for an unknown or removed
 * target), the removal rules apply (403; leaving is always allowed), and the last-owner guard refuses removing the
 * last active owner (409 `last_owner`). Then the membership turns `removed` (their sessions get 404 on the company
 * from now on), their API keys in this company are revoked (401 from now on), each with its audit row, and the
 * outbox `remove_member` call follows (a new key for every removal: a person can be invited back and removed again).
 */
export function removeMember(repo: MembersRepo, t: TenantDb, call: Removal): Promise<{ ok: true } | Refusal> {
  return t.transaction(async (tx) => {
    const pair = checkPair(...(await repo.lockedPair(tx, call.actorId, call.membershipId)));
    if ('ok' in pair) return pair;
    const { actor, target } = pair;
    const refusal = removalRefusal(actor.role, target.role, actor.id === target.id);
    if (refusal) return refusal;
    if (takesLastOwner(target, 'removed', await repo.activeOwners(tx))) return LAST_OWNER;
    const after = await repo.update(tx, target.id, { status: 'removed' });
    const keys = await repo.revokeKeys(tx, target.principalId, call.now);
    const who = {
      actorKind: 'user',
      actorPrincipalId: actor.principalId,
      requestId: call.requestId,
    } as const;
    await repo.audit(tx, {
      ...who,
      entityType: 'membership',
      entityId: target.id,
      action: 'remove',
      changes: diffFields({ status: target.status }, { status: after.status }),
    });
    for (const key of keys) {
      await repo.audit(tx, {
        ...who,
        entityType: 'api_key',
        entityId: key.id,
        action: 'revoke',
        changes: diffFields({ revokedAt: null }, { revokedAt: key.revokedAt }),
      });
    }
    // S2 (org_positions, docs/roadmap.md S2.4): the person's direct reports move up to their manager here, in this
    // transaction, before the outbox call.
    await enqueueOutbox(tx, {
      op: 'remove_member',
      idempotencyKey: outboxKey('remove_member', target.id, newId()),
      payload: { membershipId: target.id },
    });
    return { ok: true as const };
  });
}
