import { InMemoryIdentityStore } from '@mwc/identity-core/memory-store';
import type { SeedableStore, StoreContractTarget } from './target.ts';

/** `InMemoryIdentityStore` as a seedable store: the reference every other store must match. */
export function memorySeedableStore(
  store: InMemoryIdentityStore = new InMemoryIdentityStore(),
): SeedableStore {
  return {
    store,
    addCompany: async (input) => store.addCompany(input),
    addUser: async (input) => store.addUser(input),
    addMembership: async (input) => store.addMembership(input),
    addInvitation: async (input) => store.addInvitation(input),
    snapshot: async () => store.snapshot(),
  };
}

/** The contract's target for the in-memory store: a new store per case. */
export function memoryStoreTarget(): StoreContractTarget {
  return { fresh: async () => memorySeedableStore(), cleanup: async () => {} };
}
