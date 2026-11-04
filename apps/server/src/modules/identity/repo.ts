import { type DbHandle, type RawDb, rawDb } from '@mwc/db/system';
import type {
  IdentityMark,
  IdentityStore,
  InvitationPatch,
  NewStoredMembership,
  NewStoredUser,
  StoredCompany,
  StoredInvitation,
  StoredMembership,
  StoredUser,
} from '@mwc/identity-core';
import type { NormalizedIdentityEvent } from '@mwc/shared/identity';
import * as bookkeeping from './repo/bookkeeping.ts';
import * as invitations from './repo/invitations.ts';
import * as memberships from './repo/memberships.ts';
import * as users from './repo/users.ts';

export interface DbIdentityStoreOptions {
  /**
   * The identity provider's kind (`clerk`; the fake's is `fake`): written to `user_identities.provider` for a
   * new person, and the identity `getUserById` returns.
   */
  readonly provider: string;
}

/**
 * `@mwc/identity-core`'s `IdentityStore` on the database: users with their identities, companies, memberships
 * (each with its person principal), invitations, and the projector's marks and parked events. It passes the
 * same store contract as the in-memory store (`@mwc/testkit/store-contract`).
 *
 * The projector works across companies (a person's memberships everywhere, an invitation found by its id
 * alone), so this store reads the raw database (`@mwc/db/system`): the identity module's repo is the one place
 * in `modules/` allowed to (biome.json). A malformed id finds nothing instead of failing. `transaction(work)`
 * runs `work` on a store bound to one transaction: the webhook inbox projects each event in one (S1.8).
 */
export class DbIdentityStore implements IdentityStore {
  readonly #db: RawDb;
  readonly #provider: string;

  constructor(db: RawDb, options: DbIdentityStoreOptions) {
    this.#db = db;
    this.#provider = options.provider;
  }

  /** Runs `work` in one transaction (a savepoint when already inside one); an error rolls it all back. */
  transaction<T>(work: (store: DbIdentityStore) => Promise<T>): Promise<T> {
    return this.#db.transaction((tx) => work(new DbIdentityStore(tx, { provider: this.#provider })));
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
    return memberships.upsertMembership(this.#db, membership);
  }

  getInvitation(id: string): Promise<StoredInvitation | undefined> {
    return invitations.getInvitation(this.#db, id);
  }

  getInvitationByExternalId(externalInvitationId: string): Promise<StoredInvitation | undefined> {
    return invitations.getInvitationByExternalId(this.#db, externalInvitationId);
  }

  updateInvitation(id: string, patch: InvitationPatch): Promise<StoredInvitation> {
    return invitations.updateInvitation(this.#db, id, patch);
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
}

/** The database store on a handle. */
export function dbIdentityStore(handle: DbHandle, options: DbIdentityStoreOptions): DbIdentityStore {
  return new DbIdentityStore(rawDb(handle), options);
}
