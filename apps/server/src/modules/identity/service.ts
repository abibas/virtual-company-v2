import type { DbHandle } from '@mwc/db';
import { type UserProfile, userIdOf, userProfile, userProfiles, userSubject } from './repo.ts';

/**
 * The identity module's service: who is calling (`service/me.ts`, re-exported here) and the lookups of people the
 * other modules call (profiles, a person's subject at the provider and back), so none of them reads the identity repo.
 */
export type { UserCompany, UserProfile } from './repo.ts';
export {
  companiesOf,
  isUniqueViolation,
  type MeResult,
  type MeServiceOptions,
  meService,
  RECONCILE_TRIES,
  REMEMBERED_SESSIONS,
  RecentKeys,
  retryOnUniqueViolation,
  SELF_RECONCILE_INTERVAL_MS,
  type SelfReconcileResult,
} from './service/me.ts';

/** A person's profile (their primary email, lower-cased, and status), or undefined for an unknown id. */
export function profileOf(db: DbHandle, userId: string): Promise<UserProfile | undefined> {
  return userProfile(db, userId);
}

/**
 * The profiles of these people by user id, for a company's member list (users are global rows, read here, never by
 * a new raw-access exemption); unknown ids are left out.
 */
export async function profilesOf(
  db: DbHandle,
  userIds: readonly string[],
): Promise<Map<string, UserProfile>> {
  return new Map((await userProfiles(db, userIds)).map((profile) => [profile.id, profile]));
}

/**
 * The person's subject at the identity provider of this kind (`provider.kind`), which the provider's member calls
 * name them by; undefined when they have no identity there.
 */
export function subjectOf(db: DbHandle, userId: string, provider: string): Promise<string | undefined> {
  return userSubject(db, userId, provider);
}

/** The local user of a subject at the provider whose tokens `issuer` signs; undefined for a person not linked here. */
export function userOfSubject(db: DbHandle, issuer: string, subject: string): Promise<string | undefined> {
  return userIdOf(db, issuer, subject);
}
