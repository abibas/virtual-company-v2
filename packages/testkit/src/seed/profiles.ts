import { randomBytes } from 'node:crypto';
import { type AccessProfile, accessProfiles, type DbHandle, type NewAccessProfile, owned } from '@mwc/db';

/** An access profile's own fields to seed (a Claude profile with no subscription by default). */
export type SeedProfileOptions = Partial<Omit<NewAccessProfile, 'id' | 'ownerUserId'>>;

/**
 * An access profile of a person's, through the personal layer: a Claude one with no subscription, no model and no
 * effort (its provider's defaults) unless said; its name is unique per call unless given. No rules are checked (which
 * subscription, model or effort fits is the credentials module's): give it to an agent with `seedAgent`'s `profileId`.
 */
export async function seedProfile(
  db: DbHandle,
  ownerUserId: string,
  options: SeedProfileOptions = {},
): Promise<AccessProfile> {
  const name = `Profile ${randomBytes(4).toString('hex')}`;
  const [row] = (await owned(db, ownerUserId)
    .insert(accessProfiles, { name, provider: 'claude', ...options })
    .returning()) as [AccessProfile];
  return row;
}
