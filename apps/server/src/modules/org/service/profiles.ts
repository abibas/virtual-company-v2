import type { AccessProfile, Agent, AuditEntry, TenantDb } from '@mwc/db';
import { isAiProvider, isToolProvider, storedRights, toolAccountOf } from '@mwc/shared/credentials';
import type { ServerDeps } from '../../../platform/env.ts';
import { profilesOf, type UserProfile } from '../../identity/service.ts';
import { PROFILE_COLUMNS, type profileRows, type SignInDetails } from '../repo/profiles.ts';
import type { giveRefusal } from '../rules/agents.ts';
import type { AgentProfileView, AgentToolProfileView, RunsWithView } from '../schemas/profiles.ts';

// Access profiles on the chart (S3.4, one provider each since 2026-11-10, docs/subscriptions.md): which profile an
// agent's runs use, who may give it and which fit its harness, and a member's defaults, one per provider, for the agents
// they hire (`profiles/give.ts`); its GitHub and Atlassian profiles (S7.1b, `profiles/tools.ts`); what happens to them
// when the owner leaves the company or removes the profile (`profiles/removal.ts`); what agents and the profile's owner
// see of them (here). A profile is a personal row: its owner is read with `ownersOf`, its row through the owner's layer.

/** What these steps need of the org repo (`orgRepo()` is one): the profile rows, the company's lock, audit rows. */
export type ProfileRepo = typeof profileRows & {
  lock(t: TenantDb): Promise<unknown>;
  audit(t: TenantDb, entry: AuditEntry): Promise<unknown>;
};

export type Given<T> = ({ readonly ok: true } & T) | NonNullable<ReturnType<typeof giveRefusal>>;

/**
 * A profile as agents show it: an AI profile with what its runs run (`runsWith`), a tool profile with who its sign-in
 * acts as and its rights (`tool`).
 */
export interface ProfileRef {
  readonly profile: AgentProfileView;
  readonly runsWith: RunsWithView | null;
  readonly tool: AgentToolProfileView | null;
}

/** One profile row of `owner` as a `ProfileRef`, with its sign-in's details when it is a tool profile. */
function refOf(
  row: AccessProfile,
  ownerName: string,
  signIns: ReadonlyMap<string, SignInDetails>,
): ProfileRef {
  const { id, name, provider, model, effort } = row;
  const profile = { id, name, provider, ownerUserId: row.ownerUserId, ownerName };
  if (!isToolProvider(provider)) {
    const runsWith = isAiProvider(provider) ? { model, effort, provider } : null;
    return { profile, runsWith, tool: null };
  }
  const signIn = row.credentialId === null ? undefined : signIns.get(row.credentialId);
  const account = signIn
    ? toolAccountOf(signIn.kind, signIn.accountEmail, signIn.accountMeta)
    : { account: null, site: null };
  const tool = { ...profile, provider, ...account, rights: storedRights(provider, row.rights) };
  return { profile, runsWith: null, tool };
}

/**
 * The profiles of these ids that exist, as agents show them (name, provider and owner, no subscription) with the model
 * and effort an AI profile runs, or a tool profile's account and rights, by id. People's names come from the identity
 * module's service on the handle, so this runs outside any transaction.
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
    const rows = await repo.ownerProfiles(t, owner, theirs);
    const held = rows.flatMap((row) =>
      isToolProvider(row.provider) && row.credentialId ? [row.credentialId] : [],
    );
    const signIns = new Map((await repo.ownerSignIns(t, owner, held)).map((signIn) => [signIn.id, signIn]));
    for (const row of rows) refs.set(row.id, refOf(row, displayName ?? primaryEmail, signIns));
  }
  return refs;
}

/** Every profile id an agent holds (its AI profile and its tool profiles), for `profileRefs`. */
export const profileIdsOf = (agent: Pick<Agent, (typeof PROFILE_COLUMNS)[number]>): (string | null)[] =>
  PROFILE_COLUMNS.map((column) => agent[column]);

/**
 * An agent's profile and what it runs, and its GitHub and Atlassian profiles, from `profileRefs`; each null without one
 * (or one that no longer exists, or of the wrong kind).
 */
export function profileExtras(
  refs: ReadonlyMap<string, ProfileRef>,
  agent: Pick<Agent, (typeof PROFILE_COLUMNS)[number]>,
) {
  const ref = (id: string | null) => (id === null ? undefined : refs.get(id));
  const ai = ref(agent.profileId);
  const tool = (id: string | null, provider: 'github' | 'atlassian') => {
    const found = ref(id)?.tool;
    return found?.provider === provider ? found : null;
  };
  return {
    profile: ai?.profile ?? null,
    runsWith: ai?.runsWith ?? null,
    githubProfile: tool(agent.githubProfileId, 'github'),
    atlassianProfile: tool(agent.atlassianProfileId, 'atlassian'),
  };
}

/** An agent of a company that uses one of a person's profiles, for their list of profiles. */
export interface ProfileUse {
  readonly profileId: string;
  readonly agentId: string;
  readonly name: string;
  readonly slug: string;
}

/**
 * The company's agents (archived ones too) that use one of these profiles, as their AI profile or a tool profile, in the
 * order they were created: one use per profile an agent holds of them.
 */
export async function profileUses(
  repo: ProfileRepo,
  t: TenantDb,
  profileIds: readonly string[],
): Promise<ProfileUse[]> {
  return (await repo.agentsUsing(t, profileIds)).flatMap((agent) =>
    profileIdsOf(agent)
      .filter((id): id is string => id !== null && profileIds.includes(id))
      .map((profileId) => ({ profileId, agentId: agent.id, name: agent.name, slug: agent.slug })),
  );
}

export { newAgentProfile, profileChange, setDefaultProfile } from './profiles/give.ts';
export { auditProfileRemoval, clearProfilesOf } from './profiles/removal.ts';
export { toolProfilesChange } from './profiles/tools.ts';
