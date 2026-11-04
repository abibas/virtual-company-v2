import type { NormalizedIdentityEvent } from '@mwc/shared/identity';
import { IdentityProviderError } from '../../src/errors.ts';
import { T0, world } from './world.ts';

/** The verify context the token tests pass. */
export const ctx = { authorizedParties: ['http://localhost:9951'] };

/** Resolves to the provider error a call rejected with (and fails when it resolved or threw something else). */
export async function providerError(call: () => Promise<unknown> | unknown): Promise<IdentityProviderError> {
  try {
    await call();
  } catch (error) {
    if (error instanceof IdentityProviderError) return error;
    throw error;
  }
  throw new Error('expected an IdentityProviderError');
}

export async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const all: T[] = [];
  for await (const item of items) all.push(item);
  return all;
}

/** A provider with one user (u1) in one organization, and one pending invitation. */
export async function populated() {
  const { fake } = world();
  fake.createUser({ subject: 'u1', email: 'one@x.test' });
  fake.createUser({ subject: 'u2', email: 'two@x.test' });
  const org = await fake.createOrganization({
    name: 'Acme',
    slug: 'acme',
    metadata: { mwc_company_id: 'c1' },
    createdBySubject: 'u1',
  });
  const invitation = await fake.createInvitation({
    orgExternalId: org.externalId,
    email: 'two@x.test',
    role: 'member',
    metadata: { mwc_invitation_id: 'inv-1' },
  });
  fake.drainEvents();
  return { fake, org, invitation };
}

/** A delivery to sign and parse: one user deleted. */
export const sampleEvent: NormalizedIdentityEvent = {
  provider: 'fake',
  externalEventId: 'evt_sample',
  occurredAt: T0,
  type: 'user.deleted',
  data: { subject: 'u1' },
};
