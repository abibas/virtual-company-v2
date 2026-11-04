/**
 * The identity scenario: the multi-person provider history the convergence and reconcile tests replay.
 * Test support that other packages' tests use (the `IdentityStore` contract of `@mwc/testkit`), so it lives
 * in src/ and is exported as `@mwc/identity-core/scenario`, like `./fake` and `./memory-store`.
 *
 * Its company and invitation ids are UUIDs made from names (`scenarioId('c-acme')`), the same on every
 * build, so a database store takes them and a second build links to the same rows; `nameOf(id)` gives the
 * name back.
 */
import type { ExternalUser, MembershipRole, NormalizedIdentityEvent } from '@mwc/shared/identity';
import { IDENTITY_METADATA } from '@mwc/shared/identity';
import type { FakeIdentityProvider } from './fake.ts';
import type { ProjectionContext } from './projector.ts';
import { fakeWorld, type IdentitySeeder, invitationMetadata, scenarioId } from './scenario/world.ts';

export { buildPersonHistory, type PersonHistory } from './scenario/person.ts';
export { permutations, seededRandom, shuffled } from './scenario/random.ts';
export {
  applyAll,
  fakeWorld,
  type IdentitySeeder,
  invitationMetadata,
  scenarioId,
  T0,
} from './scenario/world.ts';

export interface InviteOptions {
  /** Put our metadata on the provider invitation; default true. */
  readonly metadata?: boolean;
  /** The local row knows the provider's invitation id (the outbox stored it); default true. */
  readonly knownExternalId?: boolean;
}

export interface Scenario {
  readonly fake: FakeIdentityProvider;
  readonly ctx: ProjectionContext;
  /** Every event the provider emitted, in order. */
  readonly events: NormalizedIdentityEvent[];
  /** Every subject the scenario signed up. */
  readonly subjects: readonly string[];
  /** Company id → provider organization id. */
  readonly orgs: ReadonlyMap<string, string>;
  /** The name a company or invitation id was made from (`c-acme`, `inv-bob`); the id itself otherwise. */
  nameOf(id: string): string;
  /** Puts the local state the scenario needs into a store: companies, their owners, every invitation. */
  seed(into: IdentitySeeder): Promise<void>;
}

type SeedInvitation = Parameters<IdentitySeeder['addInvitation']>[0];

/**
 * Two companies and a person for each rule, built deterministically (the same ids and times on every
 * run), so a second build can replay the provider's history step by step (`afterStep` runs after each
 * step, e.g. to reconcile) into a store seeded from the first:
 *
 * - `u_owner` created Acme (owner here); the provider later shows them as a plain member: still owner.
 * - `u_other` created Globex, where an invitation for bob's email stays pending: never claimed by email.
 * - bob accepts a member invitation, is made admin in the provider's dashboard, edits his profile.
 * - carol's membership has no metadata: linked by the provider's invitation id; admin from her invitation.
 * - dave is removed in the provider, re-invited as member (at his second address: the seed creates every
 *   invitation up front, and a company has one pending invitation per email) and accepts again: active,
 *   from the new invitation.
 * - judy is removed in the provider and re-added in its dashboard (no invitation): stays removed.
 * - erin is added in the provider's dashboard only: never a member here.
 * - frank accepts, then deletes his account: deactivated, membership removed.
 * - gina's invitation is revoked in the provider.
 * - hank's invitation carries no metadata and his membership no invitation id: the invitation is marked
 *   accepted by its provider id, and the membership (unlinked) is refused, never matched by email.
 * - ivan's local invitation does not know its provider id yet and his membership carries none: it is
 *   learned from `invitation.accepted` whatever the order.
 */
export async function buildScenario(
  afterStep: (fake: FakeIdentityProvider) => Promise<void> = async () => {},
): Promise<Scenario> {
  const { fake, ctx } = fakeWorld();
  const events: NormalizedIdentityEvent[] = [];
  const subjects: string[] = [];
  const orgs = new Map<string, string>();
  const names = new Map<string, string>();
  const owners: { companyId: string; user: ExternalUser }[] = [];
  const invitations: SeedInvitation[] = [];
  const id = (name: string) => {
    const made = scenarioId(name);
    names.set(made, name);
    return made;
  };

  const step = async () => {
    events.push(...fake.drainEvents());
    await afterStep(fake);
  };
  const signUp = (subject: string, email = `${subject.slice(2)}@x.test`) => {
    subjects.push(subject);
    return fake.createUser({ subject, email });
  };
  const found = async (companyId: string, name: string, subject: string) => {
    const user = signUp(subject);
    const org = await fake.createOrganization({
      name,
      metadata: { [IDENTITY_METADATA.companyId]: companyId },
      createdBySubject: subject,
    });
    orgs.set(companyId, org.externalId);
    owners.push({ companyId, user });
    return org.externalId;
  };
  const invite = async (
    companyId: string,
    name: string,
    email: string,
    role: MembershipRole,
    options: InviteOptions = {},
  ) => {
    const invitationId = id(name);
    const sent = await fake.createInvitation({
      orgExternalId: orgs.get(companyId) ?? '',
      email,
      role,
      metadata: options.metadata === false ? {} : invitationMetadata(invitationId, companyId),
    });
    const externalInvitationId = options.knownExternalId === false ? null : sent.externalId;
    invitations.push({ id: invitationId, companyId, email, role, externalInvitationId });
    return sent.externalId;
  };

  const acmeId = id('c-acme');
  const globexId = id('c-globex');
  const acme = await found(acmeId, 'Acme', 'u_owner');
  await found(globexId, 'Globex', 'u_other');
  await step();

  await invite(globexId, 'inv-bob-globex', 'bob@x.test', 'member');
  signUp('u_bob');
  fake.accept(await invite(acmeId, 'inv-bob', 'bob@x.test', 'member'), 'u_bob');
  await step();
  await fake.updateMemberRole(acme, 'u_bob', 'admin');
  fake.updateUser('u_bob', { displayName: 'Bob B.' });
  await step();

  signUp('u_carol');
  fake.accept(await invite(acmeId, 'inv-carol', 'carol@x.test', 'admin'), 'u_carol', { copyMetadata: false });
  await step();

  signUp('u_dave');
  fake.accept(await invite(acmeId, 'inv-dave-1', 'dave@x.test', 'viewer'), 'u_dave');
  await step();
  await fake.removeMember(acme, 'u_dave');
  await step();
  fake.accept(await invite(acmeId, 'inv-dave-2', 'dave@work.test', 'member'), 'u_dave');
  await step();

  signUp('u_judy');
  fake.accept(await invite(acmeId, 'inv-judy', 'judy@x.test', 'member'), 'u_judy');
  await step();
  await fake.removeMember(acme, 'u_judy');
  await step();
  fake.addMember(acme, 'u_judy', 'org:member');
  await step();

  signUp('u_erin');
  fake.addMember(acme, 'u_erin', 'org:admin');
  await step();

  signUp('u_frank');
  fake.accept(await invite(acmeId, 'inv-frank', 'frank@x.test', 'member'), 'u_frank');
  await step();
  fake.deleteUser('u_frank');
  await step();

  signUp('u_gina');
  await fake.revokeInvitation(acme, await invite(acmeId, 'inv-gina', 'gina@x.test', 'member'));
  await step();

  signUp('u_hank');
  const hank = await invite(acmeId, 'inv-hank', 'hank@x.test', 'member', { metadata: false });
  fake.accept(hank, 'u_hank', { includeInvitationId: false });
  await step();

  signUp('u_ivan');
  const ivan = await invite(acmeId, 'inv-ivan', 'ivan@x.test', 'member', { knownExternalId: false });
  fake.accept(ivan, 'u_ivan', { includeInvitationId: false });
  await step();

  await fake.updateMemberRole(acme, 'u_owner', 'member');
  await step();

  return {
    fake,
    ctx,
    events,
    subjects,
    orgs,
    nameOf: (value) => names.get(value) ?? value,
    async seed(into) {
      for (const [companyId, orgExternalId] of orgs) {
        await into.addCompany({ id: companyId, identityOrgExternalId: orgExternalId });
      }
      for (const { companyId, user } of owners) {
        const row = await into.addUser({
          issuer: ctx.issuer,
          subject: user.subject,
          primaryEmail: user.primaryEmail,
          displayName: user.displayName,
        });
        await into.addMembership({ companyId, userId: row.id, role: 'owner' });
      }
      for (const invitation of invitations) await into.addInvitation(invitation);
    },
  };
}
