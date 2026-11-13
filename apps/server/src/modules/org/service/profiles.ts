import { type AccessProfile, type AuditEntry, PROFILE_TOOL_COLUMNS, type TenantDb } from '@mwc/db';
import { storedRights, TOOL_PROVIDERS, toolAccountOf } from '@mwc/shared/credentials';
import type { ToolProvider } from '@mwc/shared/enums';
import type { ServerDeps } from '../../../platform/env.ts';
import { profilesOf, type UserProfile } from '../../identity/service.ts';
import type { profileRows, SignInDetails } from '../repo/profiles.ts';
import type { giveRefusal } from '../rules/agents.ts';
import type { AgentProfileToolsView, AgentProfileView, RunsWithView } from '../schemas/profiles.ts';

// Access profiles on the chart (S3.4, one provider each since 2026-11-10, docs/subscriptions.md): which profile an
// agent's runs use, who may give it and which fit its harness, and a member's defaults, one per provider, for the agents
// they hire (`profiles/give.ts`); what happens to them when the owner leaves the company or removes the profile
// (`profiles/removal.ts`); what agents and the profile's owner see of them, its tool parts too (S7.1b, one profile since
// 2026-11-13; here). A profile is a personal row: its owner is read with `ownersOf`, its row through the owner's layer.

/** What these steps need of the org repo (`orgRepo()` is one): the profile rows, the company's lock, audit rows. */
export type ProfileRepo = typeof profileRows & {
  lock(t: TenantDb): Promise<unknown>;
  audit(t: TenantDb, entry: AuditEntry): Promise<unknown>;
};

export type Given<T> = ({ readonly ok: true } & T) | NonNullable<ReturnType<typeof giveRefusal>>;

/** A profile as agents show it (with its subscription's account and its tool parts), and what its runs run. */
export interface ProfileRef {
  readonly profile: AgentProfileView;
  readonly runsWith: RunsWithView;
}

/** Every credential of a profile whose account an agent's view shows: its subscription and its tool parts' sign-ins. */
const shownCredentials = (row: AccessProfile): string[] =>
  [row.credentialId, ...TOOL_PROVIDERS.map((tool) => row[PROFILE_TOOL_COLUMNS[tool].credential])].filter(
    (id): id is string => id !== null,
  );

/** A profile's tool parts as an agent shows them: who each sign-in acts as and where, and the part's rights. */
function toolsOf(row: AccessProfile, details: ReadonlyMap<string, SignInDetails>): AgentProfileToolsView {
  const part = <T extends ToolProvider>(tool: T) => {
    const columns = PROFILE_TOOL_COLUMNS[tool];
    const rights = row[columns.rights];
    if (rights === null) return null;
    const id = row[columns.credential];
    const signIn = id === null ? undefined : details.get(id);
    const account = signIn
      ? toolAccountOf(signIn.kind, signIn.accountEmail, signIn.accountMeta)
      : { account: null, site: null };
    return { ...account, rights: storedRights(tool, rights) };
  };
  return { github: part('github'), atlassian: part('atlassian') };
}

/** One profile row of an owner as a `ProfileRef`, with its credentials' account details (`details`). */
function refOf(
  row: AccessProfile,
  ownerName: string,
  details: ReadonlyMap<string, SignInDetails>,
): ProfileRef {
  const { id, name, provider, model, effort } = row;
  const account =
    (row.credentialId === null ? undefined : details.get(row.credentialId))?.accountEmail ?? null;
  const profile = {
    id,
    name,
    provider,
    ownerUserId: row.ownerUserId,
    ownerName,
    account,
    tools: toolsOf(row, details),
  };
  return { profile, runsWith: { model, effort, provider } };
}

/**
 * The profiles of these ids that exist, as agents show them (name, provider, owner, the accounts its subscription and
 * tool parts act as, their rights; never a secret) with the model and effort they run, by id. People's names come from
 * the identity module's service on the handle, so this runs outside any transaction.
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
    const held = await repo.ownerCredentials(t, owner, rows.flatMap(shownCredentials));
    const details = new Map(held.map((credential) => [credential.id, credential]));
    for (const row of rows) refs.set(row.id, refOf(row, displayName ?? primaryEmail, details));
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
