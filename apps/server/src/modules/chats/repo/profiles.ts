import {
  type AccessProfile,
  accessProfiles,
  credentials,
  type Membership,
  memberships,
  ownedIn,
  ownersOf,
  type TenantDb,
} from '@mwc/db';
import { eq } from 'drizzle-orm';

/**
 * The access profiles a chat's turns run on (S5.1b): personal rows, read through the personal layer on the tenant's
 * connection (whose a profile is with `ownersOf`, then its row through its owner's layer with `ownedIn`), and the
 * membership of the person who chose a chat's profile, through the company's tenant.
 */

/** The profile's owner, or undefined when there is no such profile. */
async function ownerOf(t: TenantDb, profileId: string): Promise<string | undefined> {
  return (await ownersOf(t, accessProfiles, [profileId])).get(profileId);
}

/** The profile with its provider and credentials, as its owner's row; undefined when there is none. */
async function get(t: TenantDb, profileId: string): Promise<AccessProfile | undefined> {
  const owner = await ownerOf(t, profileId);
  if (owner === undefined) return undefined;
  const [row] = await ownedIn(t, owner).select(accessProfiles, eq(accessProfiles.id, profileId));
  return row;
}

/** The kind of a person's credential, read through their layer; undefined when there is none (S5.4). */
async function credentialKind(t: TenantDb, ownerUserId: string, credentialId: string) {
  const [row] = await ownedIn(t, ownerUserId).select(credentials, eq(credentials.id, credentialId));
  return row?.kind;
}

/** A person's membership in the company, whatever its status. */
async function membershipOf(t: TenantDb, userId: string): Promise<Membership | undefined> {
  const [row] = await t.select(memberships, eq(memberships.userId, userId));
  return row;
}

export const profilesRepo = { get, membershipOf, credentialKind };
