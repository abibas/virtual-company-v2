import { afterAll, beforeAll, describe, it } from 'vitest';
import { describesItself, getsUsers, parsesWebhooks, verifiesTokens } from './provider-contract/identity.ts';
import {
  acceptsInvitations,
  createsInvitations,
  listsInvitations,
  refusesDuplicateInvitations,
  revokesInvitations,
} from './provider-contract/invitations.ts';
import {
  createsOrganizations,
  deletesOrganizations,
  listsMembers,
  refusesTakenSlugs,
  refusesUnknownOrganizations,
  removesMembers,
  updatesRoles,
} from './provider-contract/organizations.ts';
import {
  type ContractCase,
  type ContractState,
  type ContractTarget,
  need,
} from './provider-contract/state.ts';

export { fakeContractTarget } from './provider-contract/fake-target.ts';
export {
  type AcceptResult,
  CONTRACT_WEB_ORIGIN,
  type ContractCase,
  type ContractState,
  type ContractTarget,
} from './provider-contract/state.ts';

/**
 * The `IdentityProvider` contract (docs/testing.md, "Provider contract"): one scenario that every provider
 * passes in the same way. A person signs up, a token verifies, a company's organization is created and
 * found again by its metadata, an invitation goes out, is listed, revoked or accepted (its metadata must
 * reach the membership), the member is promoted and removed, a webhook verifies, and the organization is
 * deleted. Each case builds on the ones before it, in this order.
 */
export const PROVIDER_CONTRACT: readonly ContractCase[] = [
  describesItself,
  getsUsers,
  verifiesTokens,
  createsOrganizations,
  refusesTakenSlugs,
  listsMembers,
  refusesUnknownOrganizations,
  createsInvitations,
  refusesDuplicateInvitations,
  listsInvitations,
  revokesInvitations,
  acceptsInvitations,
  updatesRoles,
  removesMembers,
  parsesWebhooks,
  deletesOrganizations,
];

export interface ProviderContractOptions {
  /** Per case, and for the target's setup and cleanup; a real provider needs seconds, not milliseconds. */
  readonly timeoutMs?: number;
}

/**
 * Registers the contract as a Vitest suite for one target (its cases run in order): `makeTarget` runs before the first
 * case and the target's `cleanup` after the last, also when a case failed.
 */
export function describeProviderContract(
  name: string,
  makeTarget: () => ContractTarget | Promise<ContractTarget>,
  options: ProviderContractOptions = {},
): void {
  const timeout = options.timeoutMs ?? 5_000;
  describe(`IdentityProvider contract: ${name}`, () => {
    // Filled by beforeAll; an array, so a failed setup simply leaves nothing to clean up.
    const states: ContractState[] = [];
    beforeAll(async () => {
      const target = await makeTarget();
      states.push({ target, provider: target.provider });
    }, timeout);
    afterAll(async () => {
      for (const state of states) await state.target.cleanup();
    }, timeout);
    for (const contractCase of PROVIDER_CONTRACT) {
      it(
        contractCase.name,
        async (context) => {
          await contractCase.run(need(states[0], 'contract target'), (note) => context.skip(note));
        },
        timeout,
      );
    }
  });
}
