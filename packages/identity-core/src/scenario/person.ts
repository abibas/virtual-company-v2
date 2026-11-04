import { IDENTITY_METADATA, type NormalizedIdentityEvent } from '@mwc/shared/identity';
import type { ProjectionContext } from '../projector.ts';
import { fakeWorld, type IdentitySeeder, invitationMetadata, scenarioId } from './world.ts';

export interface PersonHistory {
  readonly ctx: ProjectionContext;
  /** user.upserted, invitation.accepted, membership.upserted twice, user.upserted, membership.deleted. */
  readonly events: NormalizedIdentityEvent[];
  readonly companyId: string;
  readonly invitationId: string;
  /** The company, linked to its organization, and bob's viewer invitation. */
  seed(into: IdentitySeeder): Promise<void>;
}

/**
 * One person's history in six events: bob signs up, accepts a viewer invitation, is made admin in the
 * provider's dashboard, renames himself and is removed. Every one of its 720 orders must end the same.
 */
export async function buildPersonHistory(): Promise<PersonHistory> {
  const { fake, ctx } = fakeWorld();
  const companyId = scenarioId('c-acme');
  const invitationId = scenarioId('inv-bob');
  const owner = fake.createUser({ subject: 'u_owner', email: 'owner@acme.test', displayName: 'Olga' });
  const org = await fake.createOrganization({
    name: 'Acme',
    metadata: { [IDENTITY_METADATA.companyId]: companyId },
    createdBySubject: owner.subject,
  });
  fake.drainEvents();
  fake.createUser({ subject: 'u_bob', email: 'bob@x.test' });
  const invitation = await fake.createInvitation({
    orgExternalId: org.externalId,
    email: 'bob@x.test',
    role: 'viewer',
    metadata: invitationMetadata(invitationId, companyId),
  });
  fake.accept(invitation.externalId, 'u_bob');
  await fake.updateMemberRole(org.externalId, 'u_bob', 'admin');
  fake.updateUser('u_bob', { displayName: 'Bob' });
  await fake.removeMember(org.externalId, 'u_bob');
  return {
    ctx,
    events: fake.drainEvents(),
    companyId,
    invitationId,
    async seed(into) {
      await into.addCompany({ id: companyId, identityOrgExternalId: org.externalId });
      await into.addInvitation({
        id: invitationId,
        companyId,
        email: 'bob@x.test',
        role: 'viewer',
        externalInvitationId: invitation.externalId,
      });
    },
  };
}
