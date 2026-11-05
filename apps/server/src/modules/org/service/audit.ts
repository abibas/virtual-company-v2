import { diffFields, type OrgPosition, type TenantDb } from '@mwc/db';
import type { MembershipRole } from '@mwc/shared/enums';
import type { OrgRepo } from '../repo.ts';

/** Who changes the chart, from the route's `c.var.membership` (a session or an API key acting as its owner). */
export interface Caller {
  readonly principalId: string;
  readonly role: MembershipRole;
  readonly requestId: string;
}

/** Who did what to which entity, for its audit rows (always a person: agents do not change the chart yet). */
export const auditEntry = (
  caller: Caller,
  entityType: 'agent' | 'org_position',
  entityId: string,
  action: string,
) =>
  ({
    actorKind: 'user',
    actorPrincipalId: caller.principalId,
    requestId: caller.requestId,
    entityType,
    entityId,
    action,
  }) as const;

type Place = Pick<OrgPosition, 'reportsToPrincipalId' | 'title'>;

const placeOf = (position: Place | undefined) =>
  position && { reportsToPrincipalId: position.reportsToPrincipalId, title: position.title };

/**
 * The audit rows of a position, keyed by its principal: `create` (placed), `update` (moved or titled) or `delete`
 * (taken off the chart), one per changed field.
 */
export function auditPosition(
  repo: OrgRepo,
  t: TenantDb,
  caller: Caller,
  change: { principalId: string; action: string; before?: Place | undefined; after?: Place | undefined },
) {
  return repo.audit(t, {
    ...auditEntry(caller, 'org_position', change.principalId, change.action),
    changes: diffFields(placeOf(change.before), placeOf(change.after)),
  });
}
