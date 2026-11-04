import { randomBytes } from 'node:crypto';
import { FakeIdentityProvider } from '@mwc/identity-core/fake';
import { CONTRACT_WEB_ORIGIN, type ContractTarget } from './state.ts';

/** The contract's target for `FakeIdentityProvider`: what the always-on run of the contract uses. */
export function fakeContractTarget(fake: FakeIdentityProvider = new FakeIdentityProvider()): ContractTarget {
  const runId = `mwc-contract-${randomBytes(4).toString('hex')}`;
  const email = (label: string) => `${runId}-${label}@contract.test`;
  return {
    provider: fake,
    runId,
    email,
    createUser: async (label, displayName) => fake.createUser({ email: email(label), displayName }),
    mintToken: async (subject) => ({ token: `fake:${subject}`, authorizedParties: [CONTRACT_WEB_ORIGIN] }),
    missing: { subject: 'user_missing', org: 'org_missing', invitation: 'orginv_missing' },
    acceptInvitation: async (invitation) => {
      const invitee = fake.createUser({ email: invitation.email });
      fake.accept(invitation.externalId, invitee.subject);
      return { subject: invitee.subject };
    },
    signedUserDeleted: (subject) =>
      fake.webhookFor({
        provider: fake.kind,
        externalEventId: `evt_${runId}`,
        occurredAt: Date.now(),
        type: 'user.deleted',
        data: { subject },
      }),
    cleanup: async () => {},
  };
}
