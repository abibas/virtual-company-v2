import {
  type AccessProfile,
  type Agent,
  accessProfiles,
  agents,
  type Membership,
  memberships,
  ownedIn,
  ownersOf,
  type TenantDb,
} from '@mwc/db';
import { asc, eq, inArray } from 'drizzle-orm';

/**
 * The org module's reads and writes of access profiles (S3.4): the company's agents and memberships that point at one,
 * through the company's tenant, and the profiles themselves, personal rows, through the personal layer on the tenant's
 * connection: whose a profile is (`ownersOf`), then its rows through its owner's layer (`ownedIn`).
 */

/** The owner of each of these profiles that exists, by profile id. */
const profileOwners = (t: TenantDb, ids: readonly string[]): Promise<Map<string, string>> =>
  ownersOf(t, accessProfiles, ids);

/** These profiles of one owner. */
const ownerProfiles = (t: TenantDb, ownerUserId: string, ids: readonly string[]): Promise<AccessProfile[]> =>
  ownedIn(t, ownerUserId).select(accessProfiles, inArray(accessProfiles.id, [...ids]));

/** The ids of every profile a person owns. */
async function profileIdsOf(t: TenantDb, userId: string): Promise<string[]> {
  return (await ownedIn(t, userId).select(accessProfiles)).map((profile) => profile.id);
}

/** The company's agents (archived ones too) that use one of these profiles, in the order they were created. */
const agentsUsing = (t: TenantDb, profileIds: readonly string[]): Promise<Agent[]> =>
  profileIds.length === 0
    ? Promise.resolve([])
    : t
        .select(agents, inArray(agents.profileId, [...profileIds]))
        .orderBy(asc(agents.createdAt), asc(agents.id));

/** Takes their profile off these agents of the company. */
async function clearAgentProfiles(t: TenantDb, used: readonly Agent[]): Promise<void> {
  if (used.length === 0) return;
  const ids = used.map((agent) => agent.id);
  await t.update(agents, { profileId: null }, inArray(agents.id, ids));
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

/** The memberships of the company whose default is this profile. */
const defaultsUsing = (t: TenantDb, profileId: string): Promise<Membership[]> =>
  t.select(memberships, eq(memberships.defaultProfileId, profileId)).orderBy(asc(memberships.id));

async function setDefaultProfile(t: TenantDb, membershipId: string, profileId: string | null) {
  const where = eq(memberships.id, membershipId);
  const [row] = (await t.update(memberships, { defaultProfileId: profileId }, where).returning()) as [
    Membership,
  ];
  return row;
}

export const profileRows = {
  profileOwners,
  ownerProfiles,
  profileIdsOf,
  agentsUsing,
  clearAgentProfiles,
  membershipOf,
  membershipOfUser,
  defaultsUsing,
  setDefaultProfile,
};
