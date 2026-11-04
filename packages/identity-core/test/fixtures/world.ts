/**
 * Test support for identity-core's own tests (not exported): a one-company world for unit tests. The fake
 * world, the scenario, applying events and the seeded shuffles are in src/scenario.ts
 * (`@mwc/identity-core/scenario`, which the store contract of `@mwc/testkit` also uses).
 */
import type { MembershipRole } from '@mwc/shared/identity';
import { IDENTITY_METADATA } from '@mwc/shared/identity';
import { InMemoryIdentityStore } from '../../src/memory-store.ts';
import { applyAll, fakeWorld, type InviteOptions, invitationMetadata } from '../../src/scenario.ts';
import type { StoredCompany } from '../../src/store.ts';

export { applyAll, buildScenario, invitationMetadata, T0 } from '../../src/scenario.ts';

/** A fake provider on a standing clock (T0), and its projection context. */
export const world = fakeWorld;

/**
 * One company (`c-acme`) linked to a provider organization created by `u_owner`, whose local user and
 * owner membership exist as company creation (S1.5) makes them. `apply()` projects what the provider
 * emitted since the last call.
 */
export async function acmeWorld() {
  const { fake, ctx } = world();
  const store = new InMemoryIdentityStore();
  const owner = fake.createUser({ subject: 'u_owner', email: 'owner@acme.test', displayName: 'Olga' });
  const org = await fake.createOrganization({
    name: 'Acme',
    metadata: { [IDENTITY_METADATA.companyId]: 'c-acme' },
    createdBySubject: owner.subject,
  });
  fake.drainEvents();
  const company: StoredCompany = store.addCompany({ id: 'c-acme', identityOrgExternalId: org.externalId });
  const ownerRow = store.addUser({
    issuer: ctx.issuer,
    subject: owner.subject,
    primaryEmail: owner.primaryEmail,
    displayName: owner.displayName,
  });
  store.addMembership({ companyId: company.id, userId: ownerRow.id, role: 'owner' });

  /** A local invitation and its provider invitation; returns the provider's id. */
  const invite = async (
    id: string,
    email: string,
    role: MembershipRole,
    options: InviteOptions = {},
  ): Promise<string> => {
    const sent = await fake.createInvitation({
      orgExternalId: org.externalId,
      email,
      role,
      metadata: options.metadata === false ? {} : invitationMetadata(id, company.id),
    });
    store.addInvitation({
      id,
      companyId: company.id,
      email,
      role,
      externalInvitationId: options.knownExternalId === false ? null : sent.externalId,
    });
    return sent.externalId;
  };

  /** A person who signs up and accepts a new invitation; returns the provider's invitation id. */
  const join = async (subject: string, role: MembershipRole, invitationId = `inv-${subject}`) => {
    const user = fake.createUser({ subject, email: `${subject}@x.test` });
    const externalId = await invite(invitationId, user.primaryEmail, role);
    fake.accept(externalId, subject);
    return externalId;
  };

  const apply = () => applyAll(fake.drainEvents(), store, ctx);
  const membership = async (subject: string) => {
    const user = await store.getUser(ctx.issuer, subject);
    return user ? store.getMembership(company.id, user.id) : undefined;
  };
  return { fake, ctx, store, org, company, invite, join, apply, membership };
}
