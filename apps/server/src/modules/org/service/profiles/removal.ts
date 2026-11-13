import { diffFields, type Membership, type TenantDb } from '@mwc/db';
import { DEFAULT_COLUMNS } from '../../repo/profiles.ts';
import type { AuditBy } from '../audit.ts';
import type { ProfileRepo } from '../profiles.ts';

// Access profiles leaving a company (S3.4): a member who leaves takes their profiles off its agents, and a profile its
// owner removes leaves its agents and defaults, each with its audit rows. Its tool parts (S7.1b) go with the profile.

/** The audit row of a profile taken off an agent or a default, by `by`. */
function auditLoss(
  repo: ProfileRepo,
  t: TenantDb,
  by: AuditBy,
  lost: {
    readonly entityType: 'agent' | 'membership';
    readonly id: string;
    readonly field: string;
    readonly profileId: string | null;
  },
) {
  return repo.audit(t, {
    ...by,
    entityType: lost.entityType,
    entityId: lost.id,
    action: 'update',
    changes: diffFields({ [lost.field]: lost.profileId }, { [lost.field]: null }),
  });
}

/**
 * A person whose membership ended (S2.4's `unplaceMember`): every agent of the company that uses one of their access
 * profiles loses it, each with its `update` audit row by `by`, in the membership's own transaction, so their personal
 * subscriptions stop powering a company they left.
 */
export async function clearProfilesOf(repo: ProfileRepo, t: TenantDb, principalId: string, by: AuditBy) {
  // A person leaving the chart has a membership: its status is what changed.
  const { userId } = (await repo.membershipOf(t, principalId)) as Membership;
  const used = await repo.agentsUsing(t, await repo.profileIdsOf(t, userId));
  await repo.clearAgentProfiles(t, used);
  for (const agent of used) {
    await auditLoss(repo, t, by, {
      entityType: 'agent',
      id: agent.id,
      field: 'profileId',
      profileId: agent.profileId,
    });
  }
}

/**
 * Before its owner removes an access profile, in their transaction (the credentials module's): locks the company and
 * writes, by the owner, the audit rows of what the removal does here: each agent using it and each membership whose
 * default it is loses it. The foreign keys take it off them (`on delete set null`) when the profile's row goes.
 */
export async function auditProfileRemoval(
  repo: ProfileRepo,
  t: TenantDb,
  profileId: string,
  by: { readonly userId: string; readonly requestId: string },
): Promise<void> {
  await repo.lock(t);
  // The owner is a member of every company the credentials module opens (their companies).
  const owner = (await repo.membershipOfUser(t, by.userId)) as Membership;
  const who: AuditBy = { actorKind: 'user', actorPrincipalId: owner.principalId, requestId: by.requestId };
  for (const agent of await repo.agentsUsing(t, [profileId])) {
    await auditLoss(repo, t, who, { entityType: 'agent', id: agent.id, field: 'profileId', profileId });
  }
  for (const membership of await repo.defaultsUsing(t, profileId)) {
    for (const field of Object.values(DEFAULT_COLUMNS).filter((column) => membership[column] === profileId)) {
      await auditLoss(repo, t, who, { entityType: 'membership', id: membership.id, field, profileId });
    }
  }
}
