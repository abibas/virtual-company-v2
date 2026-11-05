import { CompanyNotFoundError, companies, invitations, memberships } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { NormalizedIdentityEvent } from '@mwc/shared/identity';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { projectIdentityEvent, reconcileCompany } from '../../../../src/modules/identity/service/sync.ts';
import { type AuthWorld, authWorld } from '../../../fixtures/auth.ts';
import {
  acceptAtProvider,
  DAY_MS,
  invitationRow,
  invitationsPath,
  invite,
  memberWithEmail,
  outboxRows,
  runOutbox,
  signUp,
} from '../../../fixtures/invitations.ts';
import {
  as,
  type MembersCompany,
  memberPath,
  membersCompany,
  providerRoleOf,
} from '../../../fixtures/members.ts';
import { testChart } from '../../../fixtures/org.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

const deps = () => ({ db: w.t.db, identity: w.fake, clock: w.clock, chart: testChart() });
const project = async (events: readonly NormalizedIdentityEvent[]) => {
  for (const event of events) await projectIdentityEvent(deps(), event);
};
/** Signs a person up and has them accept the invitation at the fake, returning the events that caused. */
async function signUpAndAccept(invitationId: string, email?: string) {
  w.fake.drainEvents();
  const person = signUp(w, email);
  await acceptAtProvider(w, invitationId, person.subject);
  return { person, events: w.fake.drainEvents() };
}
const orgOf = (company: MembersCompany) => company.orgId as string;
const company = () => membersCompany(w);
/** The provider membership id an acceptance's events carry. */
const providerMembershipOf = (events: readonly NormalizedIdentityEvent[]) => {
  const upserted = events.find((event) => event.type === 'membership.upserted');
  return upserted?.type === 'membership.upserted' ? upserted.data.externalMembershipId : undefined;
};

describe('acceptance through webhook events (projectIdentityEvent)', () => {
  it('makes the invitee an active member with the role of our invitation', async () => {
    const acme = await company();
    const sent = await invite(w, acme, 'hooked@x.test', 'admin');
    await runOutbox(w, acme.companyId);
    const { events } = await signUpAndAccept(sent.id, 'hooked@x.test');
    expect(events.map((event) => event.type)).toEqual([
      'user.upserted',
      'invitation.accepted',
      'membership.upserted',
    ]);
    await project(events);
    expect(await memberWithEmail(w, acme, 'hooked@x.test')).toMatchObject({
      role: 'admin',
      status: 'active',
    });
    expect(await invitationRow(w, sent.id)).toMatchObject({ status: 'accepted' });
  });

  it('converges whatever the order and however often the events come', async () => {
    const acme = await company();
    const one = await invite(w, acme, 'one@x.test', 'viewer');
    const two = await invite(w, acme, 'two@x.test', 'member');
    await runOutbox(w, acme.companyId);
    const first = await signUpAndAccept(one.id, 'one@x.test');
    const second = await signUpAndAccept(two.id, 'two@x.test');
    const events = [...first.events, ...second.events];
    await project([...events].reverse());
    await project(events);
    await project([
      events[2],
      events[0],
      events[4],
      events[1],
      events[5],
      events[3],
    ] as NormalizedIdentityEvent[]);
    expect(await memberWithEmail(w, acme, 'one@x.test')).toMatchObject({ role: 'viewer', status: 'active' });
    expect(await memberWithEmail(w, acme, 'two@x.test')).toMatchObject({ role: 'member', status: 'active' });
    expect(await outboxRows(w, acme.companyId, 'remove_member')).toEqual([]);
  });

  it('links an invitation accepted by someone with another email by its metadata, never by email', async () => {
    const acme = await company();
    const sent = await invite(w, acme, 'alice@x.test', 'viewer');
    await runOutbox(w, acme.companyId);
    const { events } = await signUpAndAccept(sent.id, 'bob-elsewhere@y.test');
    await project(events);
    expect(await memberWithEmail(w, acme, 'alice@x.test')).toBeUndefined();
    const bob = await memberWithEmail(w, acme, 'bob-elsewhere@y.test');
    expect(bob).toMatchObject({ role: 'viewer', status: 'active' });
    const [row] = await rawDb(w.t.db)
      .select()
      .from(memberships)
      .where(eq(memberships.id, bob?.id as string));
    expect(row).toMatchObject({ invitationId: sent.id });
  });

  it('activates nobody after the expiry, and queues the removal of the provider membership', async () => {
    const acme = await company();
    const sent = await invite(w, acme, 'slow@x.test', 'admin');
    await runOutbox(w, acme.companyId);
    w.clock.advance(14 * DAY_MS + 1);
    const { person, events } = await signUpAndAccept(sent.id, 'slow@x.test');
    await project(events);
    await project(events);
    expect(await memberWithEmail(w, acme, 'slow@x.test')).toBeUndefined();
    const removals = await outboxRows(w, acme.companyId, 'remove_member');
    expect(removals).toEqual([
      expect.objectContaining({
        status: 'pending',
        idempotencyKey: `remove_member:provider:${providerMembershipOf(events)}`,
        payload: expect.objectContaining({ subject: person.subject, invitationId: sent.id }),
      }),
    ]);
    expect(await runOutbox(w, acme.companyId)).toEqual(['done']);
    expect(await providerRoleOf(w, orgOf(acme), person.subject)).toBeUndefined();
  });

  it('lets our database win a revoke that crossed the acceptance: removed here and at the provider', async () => {
    const acme = await company();
    const sent = await invite(w, acme, 'crossed@x.test');
    await runOutbox(w, acme.companyId);
    const { person, events } = await signUpAndAccept(sent.id, 'crossed@x.test');
    expect((await as(w, acme.owner)('DELETE', `${invitationsPath(acme)}/${sent.id}`)).status).toBe(204);
    await project(events);
    expect(await memberWithEmail(w, acme, 'crossed@x.test')).toBeUndefined();
    expect(await invitationRow(w, sent.id)).toMatchObject({ status: 'revoked' });
    expect((await outboxRows(w, acme.companyId, 'remove_member')).map((row) => row.payload.subject)).toEqual([
      person.subject,
    ]);
    // revoke_invite meets an accepted invitation (done), then the provider membership goes.
    expect(await runOutbox(w, acme.companyId)).toEqual(['done', 'done']);
    expect(await providerRoleOf(w, orgOf(acme), person.subject)).toBeUndefined();
  });

  it("ignores the revocation of the copy a resend replaced, even before the new copy's id is stored", async () => {
    const acme = await company();
    const sent = await invite(w, acme, 'resend-window@x.test');
    await runOutbox(w, acme.companyId);
    await as(w, acme.owner)('POST', `${invitationsPath(acme)}/${sent.id}/resend`);
    w.fake.drainEvents();
    w.fake.failNext('createInvitation');
    expect(await runOutbox(w, acme.companyId)).toEqual(['retry']);
    const revoked = w.fake.drainEvents();
    expect(revoked.map((event) => event.type)).toEqual(['invitation.revoked']);
    const [change] = await projectIdentityEvent(deps(), revoked[0] as NormalizedIdentityEvent);
    expect(change).toMatchObject({ action: 'ignored', reason: 'replaced_provider_invitation' });
    expect(await reconcileCompany(deps(), acme.companyId)).toMatchObject({ organization: 'linked' });
    expect(await invitationRow(w, sent.id)).toMatchObject({ status: 'pending' });
  });
});

describe('projectIdentityEvent: links without metadata, people not linked yet, organizations we do not know', () => {
  it("queues the removal of a refused membership found by the provider's invitation id, before its person is known", async () => {
    const acme = await company();
    const sent = await invite(w, acme, 'no-metadata@x.test');
    await runOutbox(w, acme.companyId);
    await as(w, acme.owner)('DELETE', `${invitationsPath(acme)}/${sent.id}`);
    const person = signUp(w, 'no-metadata@x.test');
    w.fake.drainEvents();
    const external = (await invitationRow(w, sent.id))?.externalInvitationId as string;
    w.fake.accept(external, person.subject, { copyMetadata: false });
    const membership = w.fake.drainEvents().filter((event) => event.type === 'membership.upserted');
    expect(await projectIdentityEvent(deps(), membership[0] as NormalizedIdentityEvent)).toEqual([
      expect.objectContaining({ action: 'deferred', reason: 'unknown_user' }),
    ]);
    expect((await outboxRows(w, acme.companyId, 'remove_member')).map((row) => row.payload)).toEqual([
      expect.objectContaining({ subject: person.subject, invitationId: sent.id }),
    ]);
  });

  it('changes nothing and queues nothing for events about an organization we do not know', async () => {
    const base = { provider: 'fake', occurredAt: w.clock().getTime(), externalEventId: 'evt_unknown_org' };
    const invitation = {
      externalId: 'orginv_unknown',
      orgExternalId: 'org_unknown',
      email: 'x@x.test',
      providerRole: 'org:member',
      status: 'revoked' as const,
      metadata: {},
      updatedAt: 1,
    };
    const revoked = { ...base, type: 'invitation.revoked', data: invitation } as const;
    expect(await projectIdentityEvent(deps(), revoked)).toEqual([
      expect.objectContaining({ action: 'ignored', reason: 'unknown_invitation' }),
    ]);
    const membership = {
      orgExternalId: 'org_unknown',
      subject: 'nobody',
      externalMembershipId: 'orgmem_unknown',
      providerRole: 'org:member',
      metadata: {},
      updatedAt: 1,
    };
    const upserted = {
      ...base,
      externalEventId: 'evt_unknown_org_2',
      type: 'membership.upserted',
      data: membership,
    };
    expect(await projectIdentityEvent(deps(), upserted as NormalizedIdentityEvent)).toEqual([
      expect.objectContaining({ action: 'deferred', reason: 'unknown_company' }),
    ]);
  });
});

describe('acceptance through the company reconcile (reconcileCompany)', () => {
  it('makes the invitee active with our role, and says what it did', async () => {
    const acme = await company();
    const sent = await invite(w, acme, 'synced@x.test', 'member');
    await runOutbox(w, acme.companyId);
    await signUpAndAccept(sent.id, 'synced@x.test');
    expect(await reconcileCompany(deps(), acme.companyId)).toEqual({
      organization: 'linked',
      members: 2,
      invitations: 1,
      removed: 0,
      changed: expect.any(Number),
      providerRemovals: 0,
    });
    expect(await memberWithEmail(w, acme, 'synced@x.test')).toMatchObject({
      role: 'member',
      status: 'active',
    });
    expect((await reconcileCompany(deps(), acme.companyId))?.changed).toBe(0);
  });

  it('brings back a removed member invited again, with the new role', async () => {
    const acme = await company();
    const first = await invite(w, acme, 'boomerang@x.test', 'viewer');
    await runOutbox(w, acme.companyId);
    const { person } = await signUpAndAccept(first.id, 'boomerang@x.test');
    await reconcileCompany(deps(), acme.companyId);
    const member = await memberWithEmail(w, acme, 'boomerang@x.test');
    expect((await as(w, acme.owner)('DELETE', memberPath(acme, member?.id as string))).status).toBe(204);
    expect(await runOutbox(w, acme.companyId)).toEqual(['done']);
    expect(await providerRoleOf(w, orgOf(acme), person.subject)).toBeUndefined();
    const second = await invite(w, acme, 'boomerang@x.test', 'admin');
    await runOutbox(w, acme.companyId);
    await acceptAtProvider(w, second.id, person.subject);
    await reconcileCompany(deps(), acme.companyId);
    expect(await memberWithEmail(w, acme, 'boomerang@x.test')).toMatchObject({
      id: member?.id,
      role: 'admin',
      status: 'active',
    });
  });

  it('queues the removal of an acceptance it refuses, and leaves a provider membership of an active member alone', async () => {
    const acme = await company();
    const sent = await invite(w, acme, 'refused@x.test');
    await runOutbox(w, acme.companyId);
    const { person } = await signUpAndAccept(sent.id, 'refused@x.test');
    await as(w, acme.owner)('DELETE', `${invitationsPath(acme)}/${sent.id}`);
    expect(await reconcileCompany(deps(), acme.companyId)).toMatchObject({ providerRemovals: 1 });
    expect(await reconcileCompany(deps(), acme.companyId)).toMatchObject({ providerRemovals: 0 });
    const active = await rawDb(w.t.db)
      .select()
      .from(memberships)
      .where(and(eq(memberships.companyId, acme.companyId), eq(memberships.status, 'active')));
    expect(active).toHaveLength(1);
    // Someone active here whose provider membership names an invitation no longer honoured is left alone.
    const kept = await invite(w, acme, 'kept@x.test');
    await runOutbox(w, acme.companyId);
    await signUpAndAccept(kept.id, 'kept@x.test');
    expect(await reconcileCompany(deps(), acme.companyId)).toMatchObject({ providerRemovals: 0 });
    await rawDb(w.t.db).update(invitations).set({ status: 'revoked' }).where(eq(invitations.id, kept.id));
    expect(await reconcileCompany(deps(), acme.companyId)).toMatchObject({ providerRemovals: 0 });
    expect(await memberWithEmail(w, acme, 'kept@x.test')).toMatchObject({ status: 'active' });
    expect((await outboxRows(w, acme.companyId, 'remove_member'))[0]?.payload).toMatchObject({
      subject: person.subject,
    });
  });

  it('has nothing to do for a company without an organization, and none for a deleted one; it needs a provider', async () => {
    const provisioning = await membersCompany(w, { provisioning: true });
    expect(await reconcileCompany(deps(), provisioning.companyId)).toEqual({
      organization: 'pending',
      members: 0,
      invitations: 0,
      removed: 0,
      changed: 0,
      providerRemovals: 0,
    });
    await rawDb(w.t.db)
      .update(companies)
      .set({ status: 'deleted' })
      .where(eq(companies.id, provisioning.companyId));
    await expect(reconcileCompany(deps(), provisioning.companyId)).rejects.toThrow(CompanyNotFoundError);
    await expect(reconcileCompany(deps(), 'not-a-company')).rejects.toThrow(CompanyNotFoundError);
    const none = { ...deps(), identity: undefined };
    await expect(reconcileCompany(none, provisioning.companyId)).rejects.toThrow(/No identity provider/);
    const event = { type: 'user.deleted', data: { subject: 's' } } as NormalizedIdentityEvent;
    await expect(projectIdentityEvent(none, event)).rejects.toThrow(/No identity provider/);
  });
});
