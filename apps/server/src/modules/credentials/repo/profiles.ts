import {
  type AccessProfile,
  accessProfiles,
  type Credential,
  credentials,
  isUuid,
  type OwnedDb,
  type OwnedSet,
  type OwnedValues,
} from '@mwc/db';
import { asc, eq, inArray } from 'drizzle-orm';

/**
 * The access profiles' data access (S3.4), through the personal layer only (`owned(db, userId)`): a person's profiles
 * and the credentials their slots hold, both theirs. The agents and defaults that point at a profile are the org
 * module's, reached through its service.
 */

/** The owner's profiles, oldest first. */
const listProfiles = (o: OwnedDb): Promise<AccessProfile[]> =>
  o.select(accessProfiles).orderBy(asc(accessProfiles.createdAt), asc(accessProfiles.id));

/** One of the owner's profiles; undefined for another person's, an unknown id or one that is not an id. */
async function getProfile(o: OwnedDb, id: string): Promise<AccessProfile | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = await o.select(accessProfiles, eq(accessProfiles.id, id));
  return row;
}

async function insertProfile(o: OwnedDb, values: OwnedValues<typeof accessProfiles>): Promise<AccessProfile> {
  const [row] = (await o.insert(accessProfiles, values).returning()) as [AccessProfile];
  return row;
}

/** Changes one of the owner's profiles, read first in the same transaction. */
async function updateProfile(
  o: OwnedDb,
  id: string,
  set: OwnedSet<typeof accessProfiles>,
): Promise<AccessProfile> {
  const [row] = (await o.update(accessProfiles, set, eq(accessProfiles.id, id)).returning()) as [
    AccessProfile,
  ];
  return row;
}

/** Removes one of the owner's profiles, read first in the same transaction; the foreign keys detach it. */
async function removeProfile(o: OwnedDb, id: string): Promise<void> {
  await o.delete(accessProfiles, eq(accessProfiles.id, id));
}

/** The owner's credentials of these ids; another person's, unknown ones and anything that is not an id are left out. */
async function credentialsOf(o: OwnedDb, ids: readonly string[]): Promise<Credential[]> {
  const valid = [...new Set(ids)].filter(isUuid);
  if (valid.length === 0) return [];
  return o.select(credentials, inArray(credentials.id, valid));
}

export const profileRows = {
  listProfiles,
  getProfile,
  insertProfile,
  updateProfile,
  removeProfile,
  credentialsOf,
};
