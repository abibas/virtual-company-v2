import {
  type AccessProfile,
  type Agent,
  type AuditEntry,
  aiPartOf,
  PROFILE_TOOL_COLUMNS,
  type TenantDb,
} from '@mwc/db';
import { HARNESS_PROVIDER, storedRights, TOOL_PROVIDERS, toolAccountOf } from '@mwc/shared/credentials';
import type { ProfileProvider, ToolProvider } from '@mwc/shared/enums';
import type { ServerDeps } from '../../../platform/env.ts';
import { profilesOf, type UserProfile } from '../../identity/service.ts';
import type { profileRows, SignInDetails } from '../repo/profiles.ts';
import type { giveRefusal } from '../rules/agents.ts';
import type { AgentProfilePartsView, AgentProfileView, RunsWithView } from '../schemas/profiles.ts';

// Access profiles on the chart (S3.4; generic profiles since 2026-11-13, docs/subscriptions.md "Profiles"): which
// profile an agent's runs use, who may give it and that it has the part the agent's harness runs on, and a member's
// defaults, one per AI part, for the agents they hire (`profiles/give.ts`); what happens to them when the owner leaves
// the company or removes the profile (`profiles/removal.ts`); what agents and the profile's owner see of them (here). A
// profile is a personal row: its owner is read with `ownersOf`, its row through the owner's layer.

/** What these steps need of the org repo (`orgRepo()` is one): the profile rows, the company's lock, audit rows. */
export type ProfileRepo = typeof profileRows & {
  lock(t: TenantDb): Promise<unknown>;
  audit(t: TenantDb, entry: AuditEntry): Promise<unknown>;
};

export type Given<T> = ({ readonly ok: true } & T) | NonNullable<ReturnType<typeof giveRefusal>>;

/** A profile as agents show it (its parts, never a subscription), and its row for what an agent runs on it. */
export interface ProfileRef {
  readonly profile: AgentProfileView;
  readonly row: AccessProfile;
}

/** The tool parts' sign-ins of a profile, whose accounts an agent's view shows. */
const signInsOf = (row: AccessProfile): string[] =>
  TOOL_PROVIDERS.map((tool) => row[PROFILE_TOOL_COLUMNS[tool].credential]).filter(
    (id): id is string => id !== null,
  );

/** A profile's parts as an agent shows them: what each AI part runs, who each tool part acts as and its rights. */
function partsOf(row: AccessProfile, signIns: ReadonlyMap<string, SignInDetails>): AgentProfilePartsView {
  const ai = (provider: ProfileProvider) => {
    const part = aiPartOf(row, provider);
    return part ? { model: part.model, effort: part.effort } : null;
  };
  const tool = <T extends ToolProvider>(provider: T) => {
    const columns = PROFILE_TOOL_COLUMNS[provider];
    const rights = row[columns.rights];
    if (rights === null) return null;
    const id = row[columns.credential];
    const signIn = id === null ? undefined : signIns.get(id);
    const account = signIn
      ? toolAccountOf(signIn.kind, signIn.accountEmail, signIn.accountMeta)
      : { account: null, site: null };
    return { ...account, rights: storedRights(provider, rights) };
  };
  return { claude: ai('claude'), openai: ai('openai'), github: tool('github'), atlassian: tool('atlassian') };
}

/**
 * The profiles of these ids that exist, as agents show them (name, owner, parts: what each AI part runs, who each tool
 * part acts as and its rights; never a secret), with their rows, by id. People's names come from the identity module's
 * service on the handle, so this runs outside any transaction.
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
    const held = await repo.ownerCredentials(t, owner, rows.flatMap(signInsOf));
    const signIns = new Map(held.map((credential) => [credential.id, credential]));
    for (const row of rows) {
      const { id, name } = row;
      const profile = {
        id,
        name,
        ownerUserId: owner,
        ownerName: displayName ?? primaryEmail,
        parts: partsOf(row, signIns),
      };
      refs.set(id, { profile, row });
    }
  }
  return refs;
}

/**
 * An agent's profile, from `profileRefs`, and what it runs: the model and effort of the profile's part for its harness.
 * The profile is null without one (or one that no longer exists); what it runs is null too when the profile has no
 * part for the harness.
 */
export function profileExtras(
  refs: ReadonlyMap<string, ProfileRef>,
  agent: Pick<Agent, 'profileId' | 'harness'>,
): { readonly profile: AgentProfileView | null; readonly runsWith: RunsWithView | null } {
  const ref = agent.profileId === null ? undefined : refs.get(agent.profileId);
  if (ref === undefined) return { profile: null, runsWith: null };
  const provider = HARNESS_PROVIDER[agent.harness];
  const part = aiPartOf(ref.row, provider);
  return {
    profile: ref.profile,
    runsWith: part ? { model: part.model, effort: part.effort, provider } : null,
  };
}

/** An agent of a company that uses one of a person's profiles, for their list of profiles and its parts' removal. */
export interface ProfileUse {
  readonly profileId: string;
  readonly agentId: string;
  readonly harness: Agent['harness'];
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
    harness: agent.harness,
    name: agent.name,
    slug: agent.slug,
  }));
}

export { newAgentProfile, profileChange, setDefaultProfile } from './profiles/give.ts';
export { auditProfileRemoval, clearProfilesOf } from './profiles/removal.ts';
