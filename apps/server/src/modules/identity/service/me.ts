import { type DbHandle, isUniqueViolation } from '@mwc/db';
import { type IdentityProvider, type ProjectionChange, reconcileUser } from '@mwc/identity-core';
import type { VerifiedIdentity } from '@mwc/shared/identity';
import { logoRef } from '@mwc/shared/logos';
import type { Actor } from '../../../platform/auth/actor.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { Throttle } from '../../../platform/http/throttle.ts';
import { dbIdentityStore, type UserCompany, type UserProfile, userCompanies, userProfile } from '../repo.ts';
import type { Me } from '../schemas.ts';

/**
 * Who is calling: `GET /api/me` with the reconcile on sign-in, and `POST /api/me/reconcile`, the same reconcile at
 * once on the person's request (S1.12), with the companies a caller sees (`companiesOf`). `../service.ts` re-exports
 * all of it.
 */

/** How many reconciled sessions one server process remembers (the oldest are forgotten first). */
export const REMEMBERED_SESSIONS = 10_000;
/** Tries of a sign-in reconcile that ran into another one (a unique violation): the first and two retries. */
export const RECONCILE_TRIES = 3;
/** How often one person may ask for a reconcile of their own (`POST /api/me/reconcile`), per server process. */
export const SELF_RECONCILE_INTERVAL_MS = 10_000;

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

/** `POST /api/me/reconcile`: what `GET /api/me` answers, or a refusal for an API key or a person asking too often. */
export type SelfReconcileResult =
  | MeResult
  | {
      readonly ok: false;
      readonly status: 429;
      readonly code: 'rate_limited';
      readonly retryAfterMs: number;
    };

export interface MeServiceOptions {
  readonly rememberedSessions?: number;
  /** One self reconcile per person per this many milliseconds (`SELF_RECONCILE_INTERVAL_MS`). */
  readonly selfReconcileIntervalMs?: number;
}

const SESSION_ONLY: SelfReconcileResult = {
  ok: false,
  status: 403,
  code: 'forbidden',
  message: 'Only a signed-in session can reconcile itself; an API key cannot',
};

interface SignInDeps extends Pick<ServerDeps, 'db' | 'logger'> {
  readonly provider: IdentityProvider;
  /** The sessions this process has reconciled. */
  readonly reconciled: RecentKeys;
}

interface SignInCall {
  readonly now: () => Date;
  /** The request's id, on the audit rows of what the reconcile changed. */
  readonly requestId: string | null;
  /** Reconcile even a session reconciled already: the person asked for it. */
  readonly force?: boolean;
}

/**
 * The linked user of a Clerk session after the sign-in reconcile, when one is due: the person is not linked
 * yet, or this session was not reconciled yet, or `force`. What the reconcile changed in memberships and invitations
 * gets its audit rows (by the system, with the request's id). Undefined when the provider has no such person.
 */
async function signIn(deps: SignInDeps, actor: Actor, identity: VerifiedIdentity, call: SignInCall) {
  const { now } = call;
  const key = identity.sessionId && `${identity.issuer}|${identity.subject}|${identity.sessionId}`;
  if (!call.force && actor.userId !== undefined && (!key || deps.reconciled.has(key))) return actor.userId;
  const store = dbIdentityStore(deps.db, { provider: deps.provider.kind, now });
  let changes: ProjectionChange[];
  try {
    ({ changes } = await retryOnUniqueViolation(() =>
      reconcileUser(identity.subject, deps.provider, store, { now }),
    ));
  } catch (error) {
    // A person seen before keeps their local state while the provider is away; a new one needs it.
    if (actor.userId === undefined) throw error;
    deps.logger.warn({ err: error, userId: actor.userId }, 'sign-in reconcile failed; serving local state');
    return actor.userId;
  }
  await store.audit(changes, call.requestId);
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

function meView(profile: UserProfile, memberships: UserCompany[], actor: Actor): Me {
  return {
    user: {
      id: profile.id,
      email: profile.primaryEmail,
      displayName: profile.displayName,
      imageUrl: profile.imageUrl,
    },
    memberships: memberships.map(({ logoSha256, ...membership }) => ({
      ...membership,
      logo: logoRef(logoSha256),
    })),
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
 *
 * `POST /api/me/reconcile` (`reconcile`) runs the same reconcile at once for a signed-in session, even one already
 * reconciled, so an invitation accepted while signed in shows up without waiting for a webhook, the periodic
 * reconcile or Sync now. One person gets one such turn every `SELF_RECONCILE_INTERVAL_MS` in this process (429
 * `rate_limited` with the time left otherwise); an API key is refused (403 `forbidden`). A provider failure for a
 * person seen before serves the local state, as `GET /api/me` does.
 */
export function meService(
  deps: Pick<ServerDeps, 'db' | 'identity' | 'logger'>,
  options: MeServiceOptions = {},
) {
  const remembered = options.rememberedSessions ?? REMEMBERED_SESSIONS;
  const reconciled = new RecentKeys(remembered);
  const turns = new Throttle(options.selfReconcileIntervalMs ?? SELF_RECONCILE_INTERVAL_MS, remembered);

  async function view(actor: Actor, userId: string | undefined): Promise<MeResult> {
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
  }

  return {
    async me(actor: Actor, now: () => Date, requestId: string | null = null): Promise<MeResult> {
      const provider = deps.identity;
      const userId =
        actor.identity !== undefined && provider !== undefined
          ? await signIn({ ...deps, provider, reconciled }, actor, actor.identity, { now, requestId })
          : actor.userId;
      return view(actor, userId);
    },

    async reconcile(
      actor: Actor,
      now: () => Date,
      requestId: string | null = null,
    ): Promise<SelfReconcileResult> {
      const provider = deps.identity;
      const identity = actor.identity;
      if (identity === undefined || provider === undefined) return SESSION_ONLY;
      const retryAfterMs = turns.take(`${identity.issuer}|${identity.subject}`, now().getTime());
      if (retryAfterMs > 0) return { ok: false, status: 429, code: 'rate_limited', retryAfterMs };
      const call = { now, requestId, force: true };
      return view(actor, await signIn({ ...deps, provider, reconciled }, actor, identity, call));
    },
  };
}
