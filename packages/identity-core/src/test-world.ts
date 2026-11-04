/**
 * Test support for identity-core's own tests (not exported): a fake provider on a standing clock, a
 * one-company world for unit tests, the multi-person scenario the convergence and reconcile tests share,
 * applying event lists, and seeded shuffles and permutations.
 */
import {
  type ExternalUser,
  IDENTITY_METADATA,
  type MembershipRole,
  type NormalizedIdentityEvent,
} from '@mwc/shared/identity';
import { FakeIdentityProvider } from './fake.ts';
import { InMemoryIdentityStore } from './memory-store.ts';
import { type ProjectionChange, type ProjectionContext, project, projectionContext } from './projector.ts';
import type { IdentityStore, StoredCompany } from './store.ts';

/** 2026-11-03T12:00:00Z: the fake's clock stands here, so its times are T0, T0+1, T0+2, ... */
export const T0 = Date.UTC(2026, 10, 3, 12);

export function world(): { fake: FakeIdentityProvider; ctx: ProjectionContext } {
  const fake = new FakeIdentityProvider({ clock: () => new Date(T0) });
  return { fake, ctx: projectionContext(fake) };
}

export async function applyAll(
  events: readonly NormalizedIdentityEvent[],
  store: IdentityStore,
  ctx: ProjectionContext,
): Promise<ProjectionChange[]> {
  const changes: ProjectionChange[] = [];
  for (const event of events) changes.push(...(await project(event, store, ctx)));
  return changes;
}

/** The store's rows without the ordering bookkeeping (marks, parked events), for comparing paths. */
export function entities(store: InMemoryIdentityStore) {
  const { marks: _marks, deferred: _deferred, ...rows } = store.snapshot();
  return rows;
}

/** Metadata the outbox puts on a provider invitation (S1.7). */
export function invitationMetadata(invitationId: string, companyId: string) {
  return { [IDENTITY_METADATA.invitationId]: invitationId, [IDENTITY_METADATA.companyId]: companyId };
}

export interface InviteOptions {
  /** Put our metadata on the provider invitation; default true. */
  readonly metadata?: boolean;
  /** The local row knows the provider's invitation id (the outbox stored it); default true. */
  readonly knownExternalId?: boolean;
}

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

export interface Scenario {
  readonly fake: FakeIdentityProvider;
  readonly ctx: ProjectionContext;
  /** Every event the provider emitted, in order. */
  readonly events: NormalizedIdentityEvent[];
  /** Every subject the scenario signed up. */
  readonly subjects: readonly string[];
  /** Company id → provider organization id. */
  readonly orgs: ReadonlyMap<string, string>;
  /** A new store with the local state the scenario needs: companies, their owners, every invitation. */
  seed(): InMemoryIdentityStore;
}

/**
 * Two companies and a person for each rule, built deterministically (the same ids and times on every
 * run), so a second build can replay the provider's history step by step (`afterStep` runs after each
 * step, e.g. to reconcile) into a store seeded from the first:
 *
 * - `u_owner` created Acme (owner here); the provider later shows them as a plain member: still owner.
 * - `u_other` created Globex, where an invitation for bob's email stays pending: never claimed by email.
 * - bob accepts a member invitation, is made admin in the provider's dashboard, edits his profile.
 * - carol's membership has no metadata: linked by the provider's invitation id; admin from her invitation.
 * - dave is removed in the provider, re-invited as member and accepts again: active, from the new invitation.
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
  const { fake, ctx } = world();
  const events: NormalizedIdentityEvent[] = [];
  const subjects: string[] = [];
  const orgs = new Map<string, string>();
  const owners: { companyId: string; user: ExternalUser }[] = [];
  const invitations: Parameters<InMemoryIdentityStore['addInvitation']>[0][] = [];

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
    id: string,
    email: string,
    role: MembershipRole,
    options: InviteOptions = {},
  ) => {
    const orgExternalId = orgs.get(companyId) ?? '';
    const sent = await fake.createInvitation({
      orgExternalId,
      email,
      role,
      metadata: options.metadata === false ? {} : invitationMetadata(id, companyId),
    });
    const externalInvitationId = options.knownExternalId === false ? null : sent.externalId;
    invitations.push({ id, companyId, email, role, externalInvitationId });
    return sent.externalId;
  };

  const acme = await found('c-acme', 'Acme', 'u_owner');
  await found('c-globex', 'Globex', 'u_other');
  await step();

  await invite('c-globex', 'inv-bob-globex', 'bob@x.test', 'member');
  signUp('u_bob');
  fake.accept(await invite('c-acme', 'inv-bob', 'bob@x.test', 'member'), 'u_bob');
  await step();
  await fake.updateMemberRole(acme, 'u_bob', 'admin');
  fake.updateUser('u_bob', { displayName: 'Bob B.' });
  await step();

  signUp('u_carol');
  fake.accept(await invite('c-acme', 'inv-carol', 'carol@x.test', 'admin'), 'u_carol', {
    copyMetadata: false,
  });
  await step();

  signUp('u_dave');
  fake.accept(await invite('c-acme', 'inv-dave-1', 'dave@x.test', 'viewer'), 'u_dave');
  await step();
  await fake.removeMember(acme, 'u_dave');
  await step();
  fake.accept(await invite('c-acme', 'inv-dave-2', 'dave@x.test', 'member'), 'u_dave');
  await step();

  signUp('u_judy');
  fake.accept(await invite('c-acme', 'inv-judy', 'judy@x.test', 'member'), 'u_judy');
  await step();
  await fake.removeMember(acme, 'u_judy');
  await step();
  fake.addMember(acme, 'u_judy', 'org:member');
  await step();

  signUp('u_erin');
  fake.addMember(acme, 'u_erin', 'org:admin');
  await step();

  signUp('u_frank');
  fake.accept(await invite('c-acme', 'inv-frank', 'frank@x.test', 'member'), 'u_frank');
  await step();
  fake.deleteUser('u_frank');
  await step();

  signUp('u_gina');
  await fake.revokeInvitation(acme, await invite('c-acme', 'inv-gina', 'gina@x.test', 'member'));
  await step();

  signUp('u_hank');
  const hank = await invite('c-acme', 'inv-hank', 'hank@x.test', 'member', { metadata: false });
  fake.accept(hank, 'u_hank', { includeInvitationId: false });
  await step();

  signUp('u_ivan');
  const ivan = await invite('c-acme', 'inv-ivan', 'ivan@x.test', 'member', { knownExternalId: false });
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
    seed() {
      const store = new InMemoryIdentityStore();
      for (const [id, orgExternalId] of orgs) store.addCompany({ id, identityOrgExternalId: orgExternalId });
      for (const { companyId, user } of owners) {
        const row = store.addUser({
          issuer: ctx.issuer,
          subject: user.subject,
          primaryEmail: user.primaryEmail,
          displayName: user.displayName,
        });
        store.addMembership({ companyId, userId: row.id, role: 'owner' });
      }
      for (const invitation of invitations) store.addInvitation(invitation);
      return store;
    },
  };
}

/** A small seeded PRNG (mulberry32): the same seed gives the same shuffles on every run. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

/** Every ordering of `items` (n! of them; keep n small). */
export function* permutations<T>(items: readonly T[]): Generator<T[]> {
  if (items.length <= 1) {
    yield [...items];
    return;
  }
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) yield [items[i] as T, ...tail];
  }
}
