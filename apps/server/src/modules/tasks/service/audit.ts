import { diffFields, type TenantDb } from '@mwc/db';
import type { MembershipRole } from '@mwc/shared/enums';
import type { TasksRepo } from '../repo.ts';

/** Who acts, from a route's guard: the member, their role and the request (a session or an API key, as themselves). */
export interface Caller {
  readonly principalId: string;
  readonly role: MembershipRole;
  readonly requestId: string;
}

export const callerOf = (v: {
  membership: { principalId: string; role: MembershipRole };
  requestId: string;
}): Caller => ({ principalId: v.membership.principalId, role: v.membership.role, requestId: v.requestId });

type Row = Readonly<Record<string, unknown>> | undefined;

/** Fields an audit row never carries: they change with every write, or are kept elsewhere (a task's history). */
export const AUDIT_IGNORED = ['createdAt', 'updatedAt', 'companyId', 'id'];

/**
 * The audit rows of a flow, a step or a task changed by `caller` (one per changed field; a create or a delete lists
 * every field), keyed by the entity's id.
 */
export function audit(
  repo: TasksRepo,
  t: TenantDb,
  caller: Caller,
  change: {
    readonly entityType: 'flow' | 'flow_step' | 'task';
    readonly entityId: string;
    readonly action: string;
    readonly before?: Row;
    readonly after?: Row;
  },
) {
  return repo.audit(t, {
    actorKind: 'user',
    actorPrincipalId: caller.principalId,
    requestId: caller.requestId,
    entityType: change.entityType,
    entityId: change.entityId,
    action: change.action,
    changes: diffFields(change.before, change.after, { ignore: AUDIT_IGNORED }),
  });
}
