import type { AuditEntry, TenantDb } from '@mwc/db';
import type { ServerDeps } from '../../../platform/env.ts';
import { profilesOf, type UserProfile } from '../../identity/service.ts';
import type { profileRows } from '../repo/profiles.ts';
import type { giveRefusal } from '../rules/agents.ts';
import type { AgentProfileView, RunsWithView } from '../schemas/profiles.ts';

// Access profiles on the chart (S3.4, one provider each since 2026-11-10, docs/subscriptions.md): which profile an
// agent's runs use, who may give it and which fit its harness, and a member's defaults, one per provider, for the agents
// they hire (`profiles/give.ts`); what happens to them when the owner leaves the company or removes the profile
// (`profiles/removal.ts`); what agents and the profile's owner see of them (here). A profile is a personal row: its
// owner is read with `ownersOf`, its row through the owner's layer.

/** What these steps need of the org repo (`orgRepo()` is one): the profile rows, the company's lock, audit rows. */
export type ProfileRepo = typeof profileRows & {
  lock(t: TenantDb): Promise<unknown>;
  audit(t: TenantDb, entry: AuditEntry): Promise<unknown>;
};

export type Given<T> = ({ readonly ok: true } & T) | NonNullable<ReturnType<typeof giveRefusal>>;

/** A profile as agents show it, and what its runs run. */
export interface ProfileRef {
  readonly profile: AgentProfileView;
  readonly runsWith: RunsWithView;
}

/**
 * The profiles of these ids that exist, as agents show them (name, provider and owner, no subscription) with the model
 * and effort they run, by id. People's names come from the identity module's service on the handle, so this runs
 * outside any transaction.
 */
export async function profileRefs(
  deps: Pick<ServerDeps, 'db'>,
  repo: ProfileRepo,
  t: TenantDb,
  ids: readonly (string | null)[],
): Promise<Map<string, ProfileRef>> {
  const wanted = ids.filter((id): id is string => id !== null);
  const owners = await repo.profileOwners(t, wanted);
  const byOwner = new Map<string, string[]>();
  for (const [id, owner] of owners) byOwner.set(owner, [...(byOwner.get(owner) ?? []), id]);
  const people = await profilesOf(deps.db, [...byOwner.keys()]);
  const refs = new Map<string, ProfileRef>();
  for (const [owner, theirs] of byOwner) {
    // A profile's owner is a user while `access_profiles.owner_user_id` keeps its key.
    const { displayName, primaryEmail } = people.get(owner) as UserProfile;
    for (const row of await repo.ownerProfiles(t, owner, theirs)) {
      const { id, name, provider, model, effort } = row;
      const profile = { id, name, provider, ownerUserId: owner, ownerName: displayName ?? primaryEmail };
      refs.set(id, { profile, runsWith: { model, effort, provider } });
    }
  }
  return refs;
}

/** An agent's profile and what it runs, from `profileRefs`; both null without one (or one that no longer exists). */
export function profileExtras(refs: ReadonlyMap<string, ProfileRef>, profileId: string | null) {
  const ref = profileId === null ? undefined : refs.get(profileId);
  return { profile: ref?.profile ?? null, runsWith: ref?.runsWith ?? null };
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

export { newAgentProfile, profileChange, setDefaultProfile } from './profiles/give.ts';
export { auditProfileRemoval, clearProfilesOf } from './profiles/removal.ts';
