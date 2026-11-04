import { describe, expect, it } from 'vitest';
import {
  describeStoreContract,
  FULL_SETTINGS,
  memoryStoreTarget,
  STORE_CONTRACT,
} from '../src/store-contract.ts';

// The contract against the in-memory store, always and with the full counts: the reference behaviour the
// database store (apps/server, modules/identity/repo) passes too.
describeStoreContract('InMemoryIdentityStore', memoryStoreTarget);

describe('the store contract', () => {
  it('has the port, convergence and reconcile cases, with unique names', () => {
    const names = STORE_CONTRACT.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names[0]).toMatch(/^upsertUser/);
    expect(names.at(-1)).toMatch(/sign-in reconcile/);
    expect(STORE_CONTRACT).toHaveLength(15);
    expect(FULL_SETTINGS).toEqual({ shuffles: 200, doubles: 25, orders: 720 });
  });

  it('gives each case a fresh, empty in-memory store', async () => {
    const target = memoryStoreTarget();
    const a = await target.fresh();
    await a.addCompany({ identityOrgExternalId: 'org_1' });
    const b = await target.fresh();
    expect((await b.snapshot()).companies).toEqual([]);
    expect(b.store).not.toBe(a.store);
    await target.cleanup();
  });
});
