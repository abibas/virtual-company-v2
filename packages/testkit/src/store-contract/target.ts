import type {
  IdentityStore,
  StoredCompany,
  StoredInvitation,
  StoredMembership,
  StoredUser,
} from '@mwc/identity-core';
import type { InMemoryIdentityStore } from '@mwc/identity-core/memory-store';
import type {
  CompanyStatus,
  InvitationStatus,
  MembershipRole,
  MembershipStatus,
  UserStatus,
} from '@mwc/shared/enums';

/** A store's whole state with ids replaced by natural keys: `InMemoryIdentityStore.snapshot()`'s shape. */
export type IdentitySnapshot = ReturnType<InMemoryIdentityStore['snapshot']>;

/**
 * One `IdentityStore` under the contract, with what the port does not have: seeding the local state that
 * company creation and invitations make (S1.5, S1.7), and a snapshot to compare stores by. Ids left out are
 * made by the target (UUID v7); every seeded email is stored lower-cased.
 */
export interface SeedableStore {
  readonly store: IdentityStore;
  /** A company, active unless `status` says otherwise. */
  addCompany(input: {
    id?: string;
    identityOrgExternalId: string | null;
    status?: CompanyStatus;
  }): Promise<StoredCompany>;
  addUser(input: {
    issuer: string;
    subject: string;
    primaryEmail: string;
    displayName: string;
    imageUrl?: string | null;
    status?: UserStatus;
  }): Promise<StoredUser>;
  /** A membership made here (granted role = role), active unless `status` says otherwise. */
  addMembership(input: {
    companyId: string;
    userId: string;
    role: MembershipRole;
    status?: MembershipStatus;
    externalMembershipId?: string | null;
    providerRole?: string | null;
    invitationId?: string | null;
  }): Promise<StoredMembership>;
  /** An invitation sent from here, pending unless `status` says otherwise. */
  addInvitation(input: {
    id?: string;
    companyId: string;
    email: string;
    role: MembershipRole;
    status?: InvitationStatus;
    externalInvitationId?: string | null;
  }): Promise<StoredInvitation>;
  snapshot(): Promise<IdentitySnapshot>;
}

export interface StoreContractTarget {
  /** A store with nothing in it: a new one, or the same database with its identity tables emptied. */
  fresh(): Promise<SeedableStore>;
  /** Runs after the last case, also when one failed. */
  cleanup(): Promise<void>;
}

/** How hard the convergence cases push: the in-memory store takes the full counts, a database fewer. */
export interface StoreContractSettings {
  /** Seeded shuffles of the scenario's events. */
  readonly shuffles: number;
  /** Shuffled runs with every event delivered twice. */
  readonly doubles: number;
  /** Orders of one person's six events (all 720 at most). */
  readonly orders: number;
}

export interface StoreContractCase {
  readonly name: string;
  run(target: StoreContractTarget, settings: StoreContractSettings): Promise<void>;
}
