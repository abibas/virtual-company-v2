import { type DbHandle, isUniqueViolation } from '@mwc/db';
import { type IdentityProvider, reconcileUser } from '@mwc/identity-core';
import type { VerifiedIdentity } from '@mwc/shared/identity';
import type { Actor } from '../../platform/auth/actor.ts';
import type { ServerDeps } from '../../platform/env.ts';
import {
  dbIdentityStore,
  type UserCompany,
  type UserProfile,
  userCompanies,
  userProfile,
  userProfiles,
  userSubject,
} from './repo.ts';
import type { Me } from './schemas.ts';

export type { UserCompany, UserProfile } from './repo.ts';

/** How many reconciled sessions one server process remembers (the oldest are forgotten first). */
export const REMEMBERED_SESSIONS = 10_000;
/** Tries of a sign-in reconcile that ran into another one (a unique violation): the first and two retries. */
export const RECONCILE_TRIES = 3;

/** Postgres' unique violation (SQLSTATE 23505), as the driver's error or the cause of Drizzle's (`@mwc/db`). */
export { isUniqueViolation };

/** Runs `work` again when it lost a race to an identical insert; every step of a reconcile is idempotent. */
export async function retryOnUniqueViolation<T>(work: () => Promise<T>, tries = RECONCILE_TRIES): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (attempt >= tries || !isUniqueViolation(error)) throw error;
    }
  }
}

/** A bounded set of keys that forgets the oldest first. */
export class RecentKeys {
  readonly #keys = new Set<string>();
  readonly #max: number;

  constructor(max: number) {
    this.#max = max;
  }

  has(key: string): boolean {
    return this.#keys.has(key);
  }

  add(key: string): void {
    this.#keys.delete(key);
    this.#keys.add(key);
    if (this.#keys.size > this.#max) this.#keys.delete(this.#keys.values().next().value as string);
  }
}

export type MeResult =
  | { readonly ok: true; readonly me: Me }
  | { readonly ok: false; readonly status: 401 | 403; readonly code: string; readonly message: string };

export interface MeServiceOptions {
  readonly rememberedSessions?: number;
}

interface SignInDeps extends Pick<ServerDeps, 'db' | 'logger'> {
  readonly provider: IdentityProvider;
  /** The sessions this process has reconciled. */
  readonly reconciled: RecentKeys;
}

/**
 * The linked user of a Clerk session after the sign-in reconcile, when one is due: the person is not linked
 * yet, or this session was not reconciled yet. Undefined when the provider has no such person.
 */
async function signIn(deps: SignInDeps, actor: Actor, identity: VerifiedIdentity, now: () => Date) {
  const key = identity.sessionId && `${identity.issuer}|${identity.subject}|${identity.sessionId}`;
  if (actor.userId !== undefined && (!key || deps.reconciled.has(key))) return actor.userId;
  const store = dbIdentityStore(deps.db, { provider: deps.provider.kind });
  try {
    await retryOnUniqueViolation(() => reconcileUser(identity.subject, deps.provider, store, { now }));
  } catch (error) {
    // A person seen before keeps their local state while the provider is away; a new one needs it.
    if (actor.userId === undefined) throw error;
    deps.logger.warn({ err: error, userId: actor.userId }, 'sign-in reconcile failed; serving local state');
    return actor.userId;
  }
  if (key) deps.reconciled.add(key);
  return (await store.getUser(identity.issuer, identity.subject))?.id;
}

/**
 * The companies an actor sees, exactly as `GET /api/me` lists them: their memberships that are not removed, in
 * companies that are not deleted, by name; an API key's own company only; none for a person not linked yet.
 */
export function companiesOf(db: DbHandle, actor: Actor): Promise<UserCompany[]> {
  if (actor.userId === undefined) return Promise.resolve([]);
  return userCompanies(db, actor.userId, actor.companyId);
}

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

function meView(profile: UserProfile, memberships: UserCompany[], actor: Actor): Me {
  return {
    user: {
      id: profile.id,
      email: profile.primaryEmail,
      displayName: profile.displayName,
      imageUrl: profile.imageUrl,
    },
    memberships,
    session: { via: actor.via === 'clerk' ? 'clerk' : 'api_key', pending: actor.identity?.pending ?? false },
  };
}

/**
 * `GET /api/me`: the caller's user, memberships and session. Reconcile on sign-in: for a Clerk session whose
 * `(issuer, subject)` is not linked yet, or whose session this process has not reconciled yet, the user and
 * their memberships are projected from the provider with identity-core's `reconcileUser` on the database
 * store (memberships link by invitation metadata or provider invitation id, never by email). A second call in
 * the same session reads only. Concurrent first calls are safe: the loser of an insert race retries, and the
 * retry finds the winner's rows.
 */
export function meService(
  deps: Pick<ServerDeps, 'db' | 'identity' | 'logger'>,
  options: MeServiceOptions = {},
) {
  const reconciled = new RecentKeys(options.rememberedSessions ?? REMEMBERED_SESSIONS);
  return {
    async me(actor: Actor, now: () => Date): Promise<MeResult> {
      const provider = deps.identity;
      const userId =
        actor.identity !== undefined && provider !== undefined
          ? await signIn({ ...deps, provider, reconciled }, actor, actor.identity, now)
          : actor.userId;
      const profile = userId === undefined ? undefined : await userProfile(deps.db, userId);
      if (profile === undefined) {
        return {
          ok: false,
          status: 401,
          code: 'unauthenticated',
          message: 'The identity provider has no such person',
        };
      }
      if (profile.status === 'deactivated') {
        return { ok: false, status: 403, code: 'user_deactivated', message: 'This account is deactivated' };
      }
      return {
        ok: true,
        me: meView(profile, await companiesOf(deps.db, { ...actor, userId: profile.id }), actor),
      };
    },
  };
}
