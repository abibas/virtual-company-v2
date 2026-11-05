import { FakeIdentityProvider } from '@mwc/identity-core/fake';
import { describe, expect, it } from 'vitest';
import { describeProviderContract, fakeContractTarget, PROVIDER_CONTRACT } from '../src/provider-contract.ts';

// The contract against the fake, always: the same cases the real Clerk dev instance runs on request
// (connectors/identity-clerk/test/contract.test.ts). By default the fake keeps no organization slugs, as the Clerk
// connector, so the slug case is skipped; with them, it runs.
describeProviderContract('FakeIdentityProvider', () => fakeContractTarget());
describeProviderContract('FakeIdentityProvider with organization slugs', () =>
  fakeContractTarget(new FakeIdentityProvider({ organizationSlugs: true })),
);

// A target that cannot accept invitations (as Clerk, when the sign-up through the ticket is not possible):
// the acceptance case and the cases that need a member are skipped with the reason, the rest still pass.
describeProviderContract('FakeIdentityProvider without acceptance', () => ({
  ...fakeContractTarget(),
  acceptInvitation: async () => ({ unverified: 'this target cannot accept invitations' }),
}));

describe('the provider contract', () => {
  it('has one case per port behaviour, in scenario order, with unique names', () => {
    const names = PROVIDER_CONTRACT.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names[0]).toMatch(/^describes itself/);
    expect(names.at(-1)).toMatch(/^deleteOrganization/);
    expect(PROVIDER_CONTRACT).toHaveLength(17);
  });

  it('gives each fake target its own run id and contract emails', () => {
    const fake = new FakeIdentityProvider();
    const a = fakeContractTarget(fake);
    const b = fakeContractTarget(fake);
    expect(a.provider).toBe(fake);
    expect(a.runId).toMatch(/^mwc-contract-[0-9a-f]{8}$/);
    expect(a.runId).not.toBe(b.runId);
    expect(a.email('owner')).toBe(`${a.runId}-owner@contract.test`);
  });
});
