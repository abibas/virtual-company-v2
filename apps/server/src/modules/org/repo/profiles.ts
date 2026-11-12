import {
  type AccessProfile,
  type Agent,
  accessProfiles,
  agents,
  credentials,
  type Membership,
  memberships,
  ownedIn,
  ownersOf,
  type TenantDb,
} from '@mwc/db';
import type { AiProvider, CredentialKind, CredentialStatus, ToolProvider } from '@mwc/shared/enums';
import { asc, eq, inArray, or } from 'drizzle-orm';

/**
 * The org module's reads and writes of access profiles (S3.4; tool profiles since S7.1b): the company's agents and
 * memberships that point at one, through the company's tenant, and the profiles themselves, personal rows, through the
 * personal layer on the tenant's connection: whose a profile is (`ownersOf`), then its rows through its owner's layer
 * (`ownedIn`), and a tool profile's sign-in's account details the same way (never its secret).
 */

/** The agent column of each tool's profile (S7.1b). */
export const TOOL_COLUMNS = {
  github: 'githubProfileId',
  atlassian: 'atlassianProfileId',
} as const satisfies Record<ToolProvider, keyof Agent>;

/** Every agent column that holds an access profile: its AI profile, then its tool profiles. */
export const PROFILE_COLUMNS = ['profileId', ...Object.values(TOOL_COLUMNS)] as const;

export type ProfileColumn = (typeof PROFILE_COLUMNS)[number];

/** The owner of each of these profiles that exists, by profile id. */
const profileOwners = (t: TenantDb, ids: readonly string[]): Promise<Map<string, string>> =>
  ownersOf(t, accessProfiles, ids);

/** These profiles of one owner. */
const ownerProfiles = (t: TenantDb, ownerUserId: string, ids: readonly string[]): Promise<AccessProfile[]> =>
  ownedIn(t, ownerUserId).select(accessProfiles, inArray(accessProfiles.id, [...ids]));

/** One profile, whoever owns it; undefined when there is no such profile. */
async function profileRow(t: TenantDb, id: string): Promise<AccessProfile | undefined> {
  const owner = (await profileOwners(t, [id])).get(id);
  if (owner === undefined) return undefined;
  return (await ownerProfiles(t, owner, [id]))[0];
}

/** The ids of every profile a person owns. */
async function profileIdsOf(t: TenantDb, userId: string): Promise<string[]> {
  return (await ownedIn(t, userId).select(accessProfiles)).map((profile) => profile.id);
}

/** A tool sign-in's details an agent's view shows: who it acts as, never its secret. */
export interface SignInDetails {
  readonly id: string;
  readonly kind: CredentialKind;
  readonly accountEmail: string | null;
  readonly accountMeta: Readonly<Record<string, unknown>>;
  readonly status: CredentialStatus;
}

/** These credentials of one owner, as their account details only. */
async function ownerSignIns(
  t: TenantDb,
  ownerUserId: string,
  ids: readonly string[],
): Promise<SignInDetails[]> {
  if (ids.length === 0) return [];
  const rows = await ownedIn(t, ownerUserId).select(credentials, inArray(credentials.id, [...ids]));
  return rows.map(({ id, kind, accountEmail, accountMeta, status }) => ({
    id,
    kind,
    accountEmail,
    accountMeta,
    status,
  }));
}

/**
 * The company's agents (archived ones too) that use one of these profiles as their AI profile or a tool profile, in the
 * order they were created.
 */
const agentsUsing = (t: TenantDb, profileIds: readonly string[]): Promise<Agent[]> => {
  if (profileIds.length === 0) return Promise.resolve([]);
  const ids = [...profileIds];
  const where = or(...PROFILE_COLUMNS.map((column) => inArray(agents[column], ids)));
  return t.select(agents, where).orderBy(asc(agents.createdAt), asc(agents.id));
};

/** Takes these profiles off every agent of the company that has one, in whichever of its columns. */
async function clearAgentProfiles(t: TenantDb, profileIds: readonly string[]): Promise<void> {
  if (profileIds.length === 0) return;
  for (const column of PROFILE_COLUMNS) {
    await t.update(agents, { [column]: null }, inArray(agents[column], [...profileIds]));
  }
}

/** The membership of a principal of the company, whatever its status. */
async function membershipOf(t: TenantDb, principalId: string): Promise<Membership | undefined> {
  const [row] = await t.select(memberships, eq(memberships.principalId, principalId));
  return row;
}

/** The membership of a person in the company, whatever its status. */
async function membershipOfUser(t: TenantDb, userId: string): Promise<Membership | undefined> {
  const [row] = await t.select(memberships, eq(memberships.userId, userId));
  return row;
}

/** The memberships of the company with this profile as one of their defaults. */
const defaultsUsing = (t: TenantDb, profileId: string): Promise<Membership[]> =>
  t
    .select(
      memberships,
      or(
        eq(memberships.defaultClaudeProfileId, profileId),
        eq(memberships.defaultOpenaiProfileId, profileId),
      ),
    )
    .orderBy(asc(memberships.id));

/** The membership column of each AI provider's default (tool profiles have no default). */
export const DEFAULT_COLUMNS = {
  claude: 'defaultClaudeProfileId',
  openai: 'defaultOpenaiProfileId',
} as const satisfies Record<AiProvider, keyof Membership>;

async function setDefaultProfile(
  t: TenantDb,
  membershipId: string,
  provider: AiProvider,
  profileId: string | null,
) {
  const where = eq(memberships.id, membershipId);
  const set = { [DEFAULT_COLUMNS[provider]]: profileId };
  const [row] = (await t.update(memberships, set, where).returning()) as [Membership];
  return row;
}

export const profileRows = {
  profileOwners,
  ownerProfiles,
  ownerSignIns,
  profileRow,
  profileIdsOf,
  agentsUsing,
  clearAgentProfiles,
  membershipOf,
  membershipOfUser,
  defaultsUsing,
  setDefaultProfile,
};
