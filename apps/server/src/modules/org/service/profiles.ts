import { type Agent, type AuditEntry, diffFields, type Membership, type TenantDb } from '@mwc/db';
import type { ServerDeps } from '../../../platform/env.ts';
import { profilesOf } from '../../identity/service.ts';
import type { profileRows } from '../repo/profiles.ts';
import { giveRefusal, profileStep } from '../rules/agents.ts';
import type { AgentProfileView, DefaultProfileView } from '../schemas/profiles.ts';
import { type AuditBy, auditEntry, type Caller } from './audit.ts';

// Access profiles on the chart (S3.4, docs/subscriptions.md): which profile an agent's runs use and who may give it,
// a member's default for the agents they hire, and what happens to both when the owner leaves the company or removes
// the profile. A profile is a personal row: its owner is read with `ownersOf`, its row through the owner's layer.

/** What these steps need of the org repo (`orgRepo()` is one): the profile rows, the company's lock, audit rows. */
export type ProfileRepo = typeof profileRows & {
  lock(t: TenantDb): Promise<unknown>;
  audit(t: TenantDb, entry: AuditEntry): Promise<unknown>;
};

type Given<T> = ({ readonly ok: true } & T) | NonNullable<ReturnType<typeof giveRefusal>>;

/** An owner whose user row is missing (never, while `access_profiles.owner_user_id` keeps its key). */
const UNKNOWN_OWNER = { displayName: null, primaryEmail: '' } as const;

/**
 * The profiles of these ids that exist, as agents show them (name and owner, no subscription), by id. People's names
 * come from the identity module's service on the handle, so this runs outside any transaction.
 */
export async function profileRefs(
  deps: Pick<ServerDeps, 'db'>,
  repo: ProfileRepo,
  t: TenantDb,
  ids: readonly (string | null)[],
): Promise<Map<string, AgentProfileView>> {
  const wanted = ids.filter((id): id is string => id !== null);
  const owners = await repo.profileOwners(t, wanted);
  const byOwner = new Map<string, string[]>();
  for (const [id, owner] of owners) byOwner.set(owner, [...(byOwner.get(owner) ?? []), id]);
  const people = await profilesOf(deps.db, [...byOwner.keys()]);
  const refs = new Map<string, AgentProfileView>();
  for (const [owner, theirs] of byOwner) {
    const { displayName, primaryEmail } = people.get(owner) ?? UNKNOWN_OWNER;
    for (const row of await repo.ownerProfiles(t, owner, theirs)) {
      refs.set(row.id, {
        id: row.id,
        name: row.name,
        ownerUserId: owner,
        ownerName: displayName ?? primaryEmail,
      });
    }
  }
  return refs;
}

/** Why the caller may not give this profile (`giveRefusal`), read in the caller's transaction; undefined when they may. */
async function giveCheck(repo: ProfileRepo, t: TenantDb, caller: Caller, profileId: string) {
  return giveRefusal(caller, (await repo.profileOwners(t, [profileId])).get(profileId));
}

/**
 * The profile a new agent gets: the one asked for (only the caller's own, `giveRefusal`), none for null, or the
 * caller's default in the company when it is left out.
 */
export async function newAgentProfile(
  repo: ProfileRepo,
  t: TenantDb,
  caller: Caller,
  requested: string | null | undefined,
): Promise<Given<{ readonly profileId: string | null }>> {
  if (requested === undefined) {
    const membership = (await repo.membershipOf(t, caller.principalId)) as Membership;
    return { ok: true, profileId: membership.defaultProfileId };
  }
  if (requested === null) return { ok: true, profileId: null };
  return (await giveCheck(repo, t, caller, requested)) ?? { ok: true, profileId: requested };
}

/**
 * What a change does to an agent's profile: nothing (the same one, or none asked), take it off (any admin or owner),
 * or give one (only the caller's own, `giveRefusal`).
 */
export async function profileChange(
  repo: ProfileRepo,
  t: TenantDb,
  caller: Caller,
  change: { readonly agent: Agent; readonly requested: string | null | undefined },
): Promise<Given<{ readonly set: { profileId?: string | null } }>> {
  const step = profileStep(change.agent.profileId, change.requested);
  if (step === 'none') return { ok: true, set: {} };
  if (step === 'remove') return { ok: true, set: { profileId: null } };
  const profileId = change.requested as string;
  return (await giveCheck(repo, t, caller, profileId)) ?? { ok: true, set: { profileId } };
}

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
 * Sets the caller's own default profile in the company, for the agents they hire, in one transaction under the
 * company's lock: null clears it (any active member); a profile must be the caller's own, given signed in as an admin
 * or owner (`giveRefusal`). The same value writes nothing; a change writes its `membership` audit row.
 */
export function setDefaultProfile(
  repo: ProfileRepo,
  t: TenantDb,
  caller: Caller,
  profileId: string | null,
): Promise<Given<{ readonly value: DefaultProfileView }>> {
  return t.transaction(async (tx) => {
    await repo.lock(tx);
    const membership = (await repo.membershipOf(tx, caller.principalId)) as Membership;
    const before = membership.defaultProfileId;
    const step = profileStep(before, profileId);
    if (step === 'none') return { ok: true as const, value: { defaultProfileId: before } };
    if (step === 'give') {
      const refusal = await giveCheck(repo, tx, caller, profileId as string);
      if (refusal) return refusal;
    }
    const after = await repo.setDefaultProfile(tx, membership.id, profileId);
    await repo.audit(tx, {
      ...auditEntry(caller, 'membership', membership.id, 'update'),
      changes: diffFields({ defaultProfileId: before }, { defaultProfileId: after.defaultProfileId }),
    });
    return { ok: true as const, value: { defaultProfileId: after.defaultProfileId } };
  });
}

/** An agent of a company that uses one of a person's profiles, for their list of profiles. */
export interface ProfileUse {
  readonly profileId: string;
  readonly agentId: string;
  readonly name: string;
  readonly slug: string;
}

/** The company's agents (archived ones too) that use one of these profiles, in the order they were created. */
export async function profileUses(
  repo: ProfileRepo,
  t: TenantDb,
  profileIds: readonly string[],
): Promise<ProfileUse[]> {
  return (await repo.agentsUsing(t, profileIds)).map((agent) => ({
    profileId: agent.profileId as string,
    agentId: agent.id,
    name: agent.name,
    slug: agent.slug,
  }));
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
    await auditLoss(repo, t, who, {
      entityType: 'membership',
      id: membership.id,
      field: 'defaultProfileId',
      profileId,
    });
  }
}
