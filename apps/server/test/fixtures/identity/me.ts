/**
 * An invitation accepted at the fake provider for a company linked to a fake organization, as S1.7 will send it:
 * the local invitation row, the provider invitation carrying its id in the metadata, and the invitee's acceptance.
 */
import { invitations, tenant } from '@mwc/db';
import { IDENTITY_METADATA } from '@mwc/shared/identity';
import { seedCompany } from '@mwc/testkit';
import type { AuthWorld } from '../platform/auth.ts';
import { newSubject } from '../platform/auth.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function acceptedInvitation(w: AuthWorld, role: 'admin' | 'member' | 'viewer' = 'member') {
  const org = await w.fake.createOrganization({ name: 'Acme', metadata: {} });
  const seeded = await seedCompany(w.t.db, { identityOrgId: org.externalId });
  const subject = newSubject('invitee');
  const email = `${subject}@invitee.test`;
  const scoped = await tenant(w.t.db, seeded.company.id);
  const [row] = await scoped
    .insert(invitations, {
      emailNormalized: email,
      role,
      expiresAt: new Date(w.clock().getTime() + 14 * DAY_MS),
    })
    .returning();
  const invitation = row as { id: string };
  const sent = await w.fake.createInvitation({
    orgExternalId: org.externalId,
    email,
    role,
    metadata: {
      [IDENTITY_METADATA.invitationId]: invitation.id,
      [IDENTITY_METADATA.companyId]: seeded.company.id,
    },
  });
  w.fake.createUser({ subject, email, displayName: 'Bob Invitee' });
  w.fake.accept(sent.externalId, subject);
  return { company: seeded.company, invitationId: invitation.id, subject, email };
}
