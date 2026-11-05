import { type DbHandle, type RawDb, rawDb } from '@mwc/db/system';
import type {
  IdentityMark,
  IdentityStore,
  InvitationPatch,
  NewStoredMembership,
  NewStoredUser,
  ProjectionChange,
  StoredCompany,
  StoredInvitation,
  StoredMembership,
  StoredUser,
} from '@mwc/identity-core';
import type { NormalizedIdentityEvent } from '@mwc/shared/identity';
import { auditProjection } from './repo/audit.ts';
import * as bookkeeping from './repo/bookkeeping.ts';
import type { ChartActor, MemberChart } from './repo/chart.ts';
import * as invitations from './repo/invitations.ts';
import {
  getUserProfile,
  getUserProfiles,
  listUserCompanies,
  type UserCompany,
  type UserProfile,
} from './repo/me.ts';
import * as memberships from './repo/memberships.ts';
import * as users from './repo/users.ts';

export interface DbIdentityStoreOptions {
  /**
   * The identity provider's kind (`clerk`; the fake's is `fake`): written to `user_identities.provider` for a
   * new person, and the identity `getUserById` returns.
   */
  readonly provider: string;
  /**
   * The current time (the app's clock; the system clock by default): a pending invitation past its expiry reads as
   * `expired` from then on.
   */
  readonly now?: () => Date;
  /** The org chart a membership that starts or ends moves its person on (the org module's, from `ChartDeps`). */
  readonly chart: MemberChart;
  /**
   * The id on the audit rows of those chart moves, by the system: a webhook event's delivery id, the id of the request
   * that ran a reconcile; none (the default) for the periodic reconcile.
   */
  readonly requestId?: string | null;
}

/**
 * `@mwc/identity-core`'s `IdentityStore` on the database: users with their identities, companies, memberships
 * (each with its person principal), invitations, and the projector's marks and parked events. It passes the
 * same store contract as the in-memory store (`@mwc/testkit/store-contract`).
 *
 * The projector works across companies (a person's memberships everywhere, an invitation found by its id
 * alone), so this store reads the raw database (`@mwc/db/system`): the identity module's repo is the one place
 * in `modules/` allowed to (biome.json). A malformed id finds nothing instead of failing. `transaction(work)`
 * runs `work` on a store bound to one transaction: the webhook inbox projects each event in one, with its audit rows
 * (`audit`), S1.8. A membership that turns active or stops being active moves its person on the org chart (`chart`)
 * in the membership's own transaction (S2.4); the in-memory store has no chart, since the store contract has none.
 */
export class DbIdentityStore implements IdentityStore {
  readonly #db: RawDb;
  readonly #options: DbIdentityStoreOptions;
  readonly #provider: string;
  readonly #now: () => Date;
  readonly #chart: { readonly chart: MemberChart; readonly by: ChartActor };

  constructor(db: RawDb, options: DbIdentityStoreOptions) {
    this.#db = db;
    this.#options = options;
    this.#provider = options.provider;
    this.#now = options.now ?? (() => new Date());
    const by = { actorKind: 'system', actorPrincipalId: null, requestId: options.requestId ?? null } as const;
    this.#chart = { chart: options.chart, by };
  }

  /** Runs `work` in one transaction (a savepoint when already inside one); an error rolls it all back. */
  transaction<T>(work: (store: DbIdentityStore) => Promise<T>): Promise<T> {
    return this.#db.transaction((tx) => work(new DbIdentityStore(tx, this.#options)));
  }

  getUser(issuer: string, subject: string): Promise<StoredUser | undefined> {
    return users.getUser(this.#db, issuer, subject);
  }

  getUserById(id: string): Promise<StoredUser | undefined> {
    return users.getUserById(this.#db, id, this.#provider);
  }

  upsertUser(user: NewStoredUser): Promise<StoredUser> {
    return users.upsertUser(this.#db, user, this.#provider);
  }

  getCompany(id: string): Promise<StoredCompany | undefined> {
    return memberships.getCompany(this.#db, id);
  }

  getCompanyByOrgExternalId(orgExternalId: string): Promise<StoredCompany | undefined> {
    return memberships.getCompanyByOrgExternalId(this.#db, orgExternalId);
  }

  getMembership(companyId: string, userId: string): Promise<StoredMembership | undefined> {
    return memberships.getMembership(this.#db, companyId, userId);
  }

  listMemberships(
    filter: { readonly companyId: string } | { readonly userId: string },
  ): Promise<StoredMembership[]> {
    return memberships.listMemberships(this.#db, filter);
  }

  upsertMembership(membership: NewStoredMembership): Promise<StoredMembership> {
    return memberships.upsertMembership(this.#db, membership, this.#chart);
  }

  getInvitation(id: string): Promise<StoredInvitation | undefined> {
    return invitations.getInvitation(this.#db, id, this.#now());
  }

  getInvitationByExternalId(externalInvitationId: string): Promise<StoredInvitation | undefined> {
    return invitations.getInvitationByExternalId(this.#db, externalInvitationId, this.#now());
  }

  updateInvitation(id: string, patch: InvitationPatch): Promise<StoredInvitation> {
    return invitations.updateInvitation(this.#db, id, patch, this.#now());
  }

  getMark(key: string): Promise<IdentityMark | undefined> {
    return bookkeeping.getMark(this.#db, key);
  }

  setMark(key: string, mark: IdentityMark): Promise<void> {
    return bookkeeping.setMark(this.#db, key, mark);
  }

  defer(key: string, event: NormalizedIdentityEvent): Promise<void> {
    return bookkeeping.defer(this.#db, key, event);
  }

  takeDeferred(key: string): Promise<NormalizedIdentityEvent[]> {
    return bookkeeping.takeDeferred(this.#db, key);
  }

  /**
   * Writes the audit rows of a projection's changes (system actor) on this store's database (`repo/audit.ts`):
   * inside `transaction()`, in the projection's own transaction, with the provider event's id as `requestId`; after a
   * reconcile, with the id of the request that ran it, or none for the periodic reconcile.
   */
  audit(changes: readonly ProjectionChange[], requestId: string | null): Promise<number> {
    return auditProjection(this.#db, changes, requestId);
  }
}

export type { ChartActor, ChartDeps, MemberChart } from './repo/chart.ts';
export {
  claimDueInboxEvents,
  type InboxOutcome,
  recordInboxEvent,
  recordInboxOutcome,
} from './repo/events.ts';
export type { UserCompany, UserProfile } from './repo/me.ts';

/** The user's profile (`GET /api/me`), by id. */
export function userProfile(handle: DbHandle, id: string): Promise<UserProfile | undefined> {
  return getUserProfile(rawDb(handle), id);
}

/** The profiles of these users (a company's member list); unknown ids are left out. */
export function userProfiles(handle: DbHandle, ids: readonly string[]): Promise<UserProfile[]> {
  return getUserProfiles(rawDb(handle), ids);
}

/** The user's subject at the identity provider of this kind (`clerk`, `fake`), or undefined when they have none. */
export async function userSubject(
  handle: DbHandle,
  userId: string,
  provider: string,
): Promise<string | undefined> {
  return (await users.getUserById(rawDb(handle), userId, provider))?.subject;
}

/** The provider invitations a resend replaced in this company (`repo/invitations.ts`). */
export function replacedInvitations(handle: DbHandle, companyId: string): Promise<Set<string>> {
  return invitations.replacedExternalIds(rawDb(handle), companyId);
}

/** The local user's id for `(issuer, subject)`, or undefined when that person is not linked here. */
export async function userIdOf(
  handle: DbHandle,
  issuer: string,
  subject: string,
): Promise<string | undefined> {
  return (await users.getUser(rawDb(handle), issuer, subject))?.id;
}

/** The user's memberships that are not removed, in companies that are not deleted (one company's, if given). */
export function userCompanies(
  handle: DbHandle,
  userId: string,
  onlyCompanyId?: string,
): Promise<UserCompany[]> {
  return listUserCompanies(rawDb(handle), userId, onlyCompanyId);
}

/** The database store on a handle. */
export function dbIdentityStore(handle: DbHandle, options: DbIdentityStoreOptions): DbIdentityStore {
  return new DbIdentityStore(rawDb(handle), options);
}
