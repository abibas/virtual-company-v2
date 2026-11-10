import { type AuditEntry, diffFields, type OrgPosition, type TenantDb } from '@mwc/db';
import type { MembershipRole } from '@mwc/shared/enums';
import type { OrgRepo } from '../repo.ts';

/** Who changes the chart, from the route's `c.var.membership` (a session or an API key acting as its owner). */
export interface Caller {
  readonly principalId: string;
  readonly role: MembershipRole;
  readonly requestId: string;
  /** The member's person, whose access profiles are theirs to give (S3.4). */
  readonly userId: string;
  /** Signed in to the web app (a session) rather than with an API key: giving a profile needs it. */
  readonly session: boolean;
}

/**
 * Who changes the chart, on its audit rows: a member through the API (`byCaller`), or the system when a membership
 * starts or ends through the identity provider (a webhook event, a reconcile).
 */
export type AuditBy = Pick<AuditEntry, 'actorKind' | 'actorPrincipalId' | 'requestId'>;

/** Who acts, from a route's guard: the membership, how they signed in (`actor.via`) and the request id. */
export const callerOf = (v: {
  actor: { via: string };
  membership: { principalId: string; role: MembershipRole; userId: string };
  requestId: string;
}): Caller => ({
  principalId: v.membership.principalId,
  role: v.membership.role,
  requestId: v.requestId,
  userId: v.membership.userId,
  session: v.actor.via === 'clerk',
});

export const byCaller = (caller: Caller): AuditBy => ({
  actorKind: 'user',
  actorPrincipalId: caller.principalId,
  requestId: caller.requestId,
});

/** Who did what to which entity, for its audit rows (a person through the API: agents do not change the chart yet). */
export const auditEntry = (
  caller: Caller,
  entityType: 'agent' | 'org_position' | 'membership',
  entityId: string,
  action: string,
) => ({ ...byCaller(caller), entityType, entityId, action }) as const;

type Place = Pick<OrgPosition, 'reportsToPrincipalId' | 'title'>;

const placeOf = (position: Place | undefined) =>
  position && { reportsToPrincipalId: position.reportsToPrincipalId, title: position.title };

type PositionChange = {
  principalId: string;
  action: string;
  before?: Place | undefined;
  after?: Place | undefined;
};

/** A place at the top with no title differs from no place in no field; its `create` or `delete` row still says so. */
const AT_THE_TOP = [{ field: 'reportsToPrincipalId', old: null, new: null }] as const;

/**
 * The audit rows of a position, keyed by its principal, by `by`: `create` (placed), `update` (moved or titled) or
 * `delete` (taken off the chart), one per changed field; a place at the top is recorded too.
 */
export function auditPositionBy(repo: OrgRepo, t: TenantDb, by: AuditBy, change: PositionChange) {
  const changes = diffFields(placeOf(change.before), placeOf(change.after));
  return repo.audit(t, {
    ...by,
    entityType: 'org_position',
    entityId: change.principalId,
    action: change.action,
    changes: changes.length > 0 || change.action === 'update' ? changes : AT_THE_TOP,
  });
}

/** The audit rows of a position changed by a member through the API (`auditPositionBy`). */
export function auditPosition(repo: OrgRepo, t: TenantDb, caller: Caller, change: PositionChange) {
  return auditPositionBy(repo, t, byCaller(caller), change);
}
