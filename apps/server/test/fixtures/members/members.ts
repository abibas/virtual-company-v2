/**
 * The members tests' helpers: a company linked to an organization at the fake provider with its owner, people added
 * to both (a membership here, a member there), calls to the members API as one of them, and raw reads of the rows a
 * role change or a removal leaves behind (memberships, API keys; outbox and audit rows come from companies.ts).
 */
import { apiKeys, type DbHandle, memberships } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { MembershipRole, MembershipStatus } from '@mwc/shared/enums';
import { seedCompany } from '@mwc/testkit';
import { and, eq } from 'drizzle-orm';
import { call } from '../companies/companies.ts';
import { type AuthWorld, addPerson, newSubject, type Person } from '../platform/auth.ts';

export const ROLES: readonly MembershipRole[] = ['owner', 'admin', 'member', 'viewer'];

export interface MembersCompany {
  readonly companyId: string;
  /** The company's organization at the fake; null for a company still provisioning. */
  readonly orgId: string | null;
  readonly owner: Person;
  readonly members: string;
}

/**
 * A company with its owner (seeded), linked to an organization at the fake whose first member is that owner as
 * `org:admin`, unless `provisioning` (no organization yet).
 */
export async function membersCompany(w: AuthWorld, options: { provisioning?: boolean } = {}) {
  const subject = newSubject('owner');
  w.fake.createUser({ subject, email: `${subject}@owners.test`, displayName: `Owner ${subject}` });
  const org = options.provisioning
    ? undefined
    : await w.fake.createOrganization({ name: 'Members Co', metadata: {}, createdBySubject: subject });
  const seeded = await seedCompany(w.t.db, {
    identityOrgId: org?.externalId ?? null,
    ...(options.provisioning ? { status: 'provisioning' as const } : {}),
    owner: { subject, email: `${subject}@owners.test`, displayName: `Owner ${subject}` },
  });
  const companyId = seeded.company.id;
  const owner: Person = {
    subject,
    userId: seeded.owner.user.id,
    principalId: seeded.owner.principal.id,
    membershipId: seeded.owner.membership.id,
  };
  return {
    companyId,
    orgId: org?.externalId ?? null,
    owner,
    members: `/api/companies/${companyId}/members`,
  } satisfies MembersCompany;
}

/** A person with a membership here (`role`, active unless said) and, when active and linked, a member at the fake. */
export async function addMember(
  w: AuthWorld,
  company: MembersCompany,
  role: MembershipRole,
  status: MembershipStatus = 'active',
): Promise<Person> {
  const person = await addPerson(w.t.db, w.fake, company.companyId, { role, status });
  if (company.orgId !== null && status === 'active') {
    w.fake.addMember(company.orgId, person.subject, w.fake.roles.toProvider(role));
  }
  return person;
}

/** Requests to the API as this person (with `x-request-id` when given). */
export const as = (w: AuthWorld, person: Person, requestId?: string) =>
  call(w, `fake:${person.subject}`, requestId);

export const memberPath = (company: MembersCompany, person: Person | string) =>
  `${company.members}/${typeof person === 'string' ? person : person.membershipId}`;

export const membershipRow = async (db: DbHandle, id: string) =>
  (await rawDb(db).select().from(memberships).where(eq(memberships.id, id)))[0];

/** The company's active owners' membership ids. */
export const activeOwners = async (db: DbHandle, companyId: string) =>
  (
    await rawDb(db)
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.companyId, companyId),
          eq(memberships.role, 'owner'),
          eq(memberships.status, 'active'),
        ),
      )
  ).map((row) => row.id);

export const keyRow = async (db: DbHandle, id: string) =>
  (await rawDb(db).select().from(apiKeys).where(eq(apiKeys.id, id)))[0];

/** The provider role the fake has for this person in the organization, or undefined when they are not a member. */
export async function providerRoleOf(w: AuthWorld, orgId: string, subject: string) {
  for await (const member of w.fake.listOrganizationMembers(orgId)) {
    if (member.subject === subject) return member.providerRole;
  }
  return undefined;
}
