import { companies, users } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { NormalizedIdentityEvent } from '@mwc/shared/identity';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditOf, companyRow } from '../../../fixtures/companies/companies.ts';
import { deliverEvents, inboxRow, inboxRows, redelivered } from '../../../fixtures/identity/webhooks.ts';
import {
  acceptAtProvider,
  invitationRow,
  invite,
  memberWithEmail,
  runOutbox,
  signUp,
} from '../../../fixtures/members/invitations.ts';
import { as, type MembersCompany, membersCompany } from '../../../fixtures/members/members.ts';
import { type AuthWorld, authWorld } from '../../../fixtures/platform/auth.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

type Of<T extends NormalizedIdentityEvent['type']> = Extract<NormalizedIdentityEvent, { type: T }>;
const one = <T extends NormalizedIdentityEvent['type']>(
  events: readonly NormalizedIdentityEvent[],
  type: T,
) => events.find((event): event is Of<T> => event.type === type) as Of<T>;

/** A company with an invitation of `email` sent to the fake, accepted there; the events it caused, undelivered. */
async function accepted(email: string, role: 'admin' | 'member' | 'viewer' = 'member') {
  const acme = await membersCompany(w);
  const sent = await invite(w, acme, email, role);
  await runOutbox(w, acme.companyId);
  w.fake.drainEvents();
  const person = signUp(w, email);
  await acceptAtProvider(w, sent.id, person.subject);
  return { acme, sent, person, events: w.fake.drainEvents() };
}
const orgOf = (company: MembersCompany) => company.orgId as string;
const statusOfUser = async (email: string) =>
  (await rawDb(w.t.db).select().from(users).where(eq(users.primaryEmail, email)))[0]?.status;

describe('webhook deliveries through POST /api/webhooks/clerk', () => {
  it('accepts an invitation: the member is active in GET .../members with our role, every row processed', async () => {
    const { acme, sent, events } = await accepted('hooked@x.test', 'admin');
    expect(await deliverEvents(w, events)).toEqual(['processed', 'processed', 'processed']);
    expect(await memberWithEmail(w, acme, 'hooked@x.test')).toMatchObject({
      role: 'admin',
      status: 'active',
    });
    expect(await invitationRow(w, sent.id)).toMatchObject({ status: 'accepted' });
    for (const event of events) {
      expect(await inboxRow(w.t.db, event.externalEventId)).toMatchObject({
        status: 'processed',
        attempts: 1,
      });
    }
  });

  it('converges whatever the order, with replays doing nothing and redeliveries under new ids changing nothing', async () => {
    const first = await accepted('one@x.test', 'viewer');
    const second = await accepted('two@x.test', 'member');
    const events = [...first.events, ...second.events];
    expect(await deliverEvents(w, [...events].reverse())).toEqual(Array(6).fill('processed'));
    const rows = (await inboxRows(w.t.db)).length;
    expect(await deliverEvents(w, events)).toEqual(Array(6).fill('duplicate'));
    expect((await inboxRows(w.t.db)).length).toBe(rows);
    expect(
      await deliverEvents(
        w,
        events.map((event) => redelivered(event)),
      ),
    ).toEqual(Array(6).fill('processed'));
    expect(await memberWithEmail(w, first.acme, 'one@x.test')).toMatchObject({
      role: 'viewer',
      status: 'active',
    });
    expect(await memberWithEmail(w, second.acme, 'two@x.test')).toMatchObject({
      role: 'member',
      status: 'active',
    });
  });

  it('records a delivery of a type nobody projects once and changes nothing', async () => {
    const { events } = await accepted('unused@x.test');
    const unused = {
      ...one(events, 'user.upserted'),
      externalEventId: 'evt_unused',
      type: 'session.created',
    };
    expect((await deliverEvents(w, [unused as unknown as NormalizedIdentityEvent]))[0]).toBe('ignored');
    expect(await inboxRow(w.t.db, 'evt_unused')).toMatchObject({ type: 'ignored', status: 'processed' });
    expect(await statusOfUser('unused@x.test')).toBeUndefined();
  });
});

describe('a deleted object is never recreated by a later delivery', () => {
  it('keeps a deleted person deactivated and out of the company, whatever upserts come late', async () => {
    const { acme, person, events } = await accepted('gone@x.test');
    await deliverEvents(w, events);
    w.fake.deleteUser(person.subject);
    expect(await deliverEvents(w, w.fake.drainEvents())).toEqual(['processed', 'processed']);
    const upserted = one(events, 'user.upserted');
    const membership = one(events, 'membership.upserted');
    const late = [
      redelivered(upserted, { updatedAt: upserted.data.updatedAt - 1, displayName: 'Revived' }),
      redelivered(membership, { updatedAt: membership.data.updatedAt - 1 }),
      redelivered(upserted, { updatedAt: upserted.data.updatedAt + 60_000 }),
      redelivered(membership, { updatedAt: membership.data.updatedAt + 60_000 }),
    ];
    expect(await deliverEvents(w, late)).toEqual(Array(4).fill('processed'));
    expect(await statusOfUser('gone@x.test')).toBe('deactivated');
    expect(await memberWithEmail(w, acme, 'gone@x.test')).toBeUndefined();
  });

  it('keeps a membership the provider deleted removed, even when an upsert of it comes after', async () => {
    const { acme, person, events } = await accepted('dropped@x.test');
    await deliverEvents(w, events);
    w.fake.removeMember(orgOf(acme), person.subject);
    const deleted = w.fake.drainEvents();
    expect(deleted.map((event) => event.type)).toEqual(['membership.deleted']);
    expect(await deliverEvents(w, deleted)).toEqual(['processed']);
    const membership = one(events, 'membership.upserted');
    const late = [
      redelivered(membership, { updatedAt: membership.data.updatedAt - 1 }),
      redelivered(membership, { updatedAt: membership.data.updatedAt + 60_000, providerRole: 'org:admin' }),
    ];
    expect(await deliverEvents(w, late)).toEqual(['processed', 'processed']);
    expect(await memberWithEmail(w, acme, 'dropped@x.test')).toBeUndefined();
  });

  it('never brings back a company: organization events neither revive a deleted one nor make a new one', async () => {
    const { acme, events } = await accepted('late-org@x.test');
    const org = { provider: 'fake', occurredAt: w.clock().getTime(), type: 'org.upserted' } as const;
    const data = { externalId: orgOf(acme), name: 'Renamed upstream', metadata: {}, updatedAt: 1 };
    const deleted = {
      ...org,
      externalEventId: 'evt_org_gone',
      type: 'org.deleted',
      data: { externalId: orgOf(acme) },
    };
    const upserted = { ...org, externalEventId: 'evt_org_late', data };
    expect(await deliverEvents(w, [deleted, upserted] as NormalizedIdentityEvent[])).toEqual([
      'processed',
      'processed',
    ]);
    expect(await companyRow(w.t.db, acme.companyId)).toMatchObject({
      status: 'active',
      identityOrgId: orgOf(acme),
    });

    await rawDb(w.t.db)
      .update(companies)
      .set({ status: 'deleted', deletedAt: w.clock() })
      .where(eq(companies.id, acme.companyId));
    const count = (await rawDb(w.t.db).select().from(companies)).length;
    expect(await deliverEvents(w, [...events, redelivered(upserted)])).toEqual(Array(4).fill('processed'));
    expect(await companyRow(w.t.db, acme.companyId)).toMatchObject({ status: 'deleted' });
    expect((await rawDb(w.t.db).select().from(companies)).length).toBe(count);
    expect((await as(w, acme.owner)('GET', `/api/companies/${acme.companyId}`)).status).toBe(404);
    expect(await auditOf(w.t.db, acme.companyId)).not.toContainEqual(
      expect.objectContaining({
        actorKind: 'system',
        requestId: one(events, 'membership.upserted').externalEventId,
      }),
    );
  });
});

describe('the audit rows of what a delivery changed', () => {
  const byEvent = async (companyId: string, event: NormalizedIdentityEvent) =>
    (await auditOf(w.t.db, companyId)).filter((row) => row.requestId === event.externalEventId);

  it('logs the activation and the accepted invitation field by field, by the system, under the event id', async () => {
    const { acme, sent, events } = await accepted('audited@x.test', 'viewer');
    await deliverEvents(w, events);
    const membership = await byEvent(acme.companyId, one(events, 'membership.upserted'));
    expect(membership.map((row) => [row.entityType, row.action, row.field])).toEqual([
      // Placed under the inviter, the owner, while the membership turned active (S2.4).
      ['org_position', 'create', 'reportsToPrincipalId'],
      ['invitation', 'update', 'acceptedByUserId'],
      ['membership', 'activate', 'externalMembershipId'],
      ['membership', 'activate', 'grantedRole'],
      ['membership', 'activate', 'invitationId'],
      ['membership', 'activate', 'providerRole'],
      ['membership', 'activate', 'role'],
      ['membership', 'activate', 'status'],
    ]);
    expect(membership.find((row) => row.field === 'status')).toMatchObject({
      oldValue: null,
      newValue: 'active',
    });
    expect(membership[0]).toMatchObject({ oldValue: null, newValue: acme.owner.principalId });
    const invitation = await byEvent(acme.companyId, one(events, 'invitation.accepted'));
    expect(invitation).toEqual([
      expect.objectContaining({
        entityType: 'invitation',
        entityId: sent.id,
        action: 'accept',
        field: 'status',
        oldValue: 'pending',
        newValue: 'accepted',
      }),
    ]);
    for (const row of [...membership, ...invitation]) {
      expect(row).toMatchObject({ actorKind: 'system', actorPrincipalId: null, companyId: acme.companyId });
    }
    expect(await byEvent(acme.companyId, one(events, 'user.upserted'))).toEqual([]);
  });

  it('logs a role the provider changed and a removal, and nothing for a delivery that changes nothing', async () => {
    const { acme, person, events } = await accepted('promoted@x.test', 'member');
    await deliverEvents(w, events);
    await w.fake.updateMemberRole(orgOf(acme), person.subject, 'admin');
    const [promoted] = w.fake.drainEvents();
    await deliverEvents(w, [promoted as NormalizedIdentityEvent]);
    const update = await byEvent(acme.companyId, promoted as NormalizedIdentityEvent);
    expect(update.map((row) => [row.action, row.field, row.oldValue, row.newValue])).toEqual([
      ['update', 'providerRole', 'org:member', 'org:admin'],
      ['update', 'role', 'member', 'admin'],
    ]);
    w.fake.removeMember(orgOf(acme), person.subject);
    const [removed] = w.fake.drainEvents();
    await deliverEvents(w, [removed as NormalizedIdentityEvent]);
    const remove = await byEvent(acme.companyId, removed as NormalizedIdentityEvent);
    expect(remove.map((row) => [row.entityType, row.action, row.field, row.oldValue, row.newValue])).toEqual([
      ['org_position', 'delete', 'reportsToPrincipalId', acme.owner.principalId, null],
      ['membership', 'remove', 'status', 'active', 'removed'],
    ]);
    const again = redelivered(removed as Of<'membership.deleted'>);
    await deliverEvents(w, [again]);
    expect(await byEvent(acme.companyId, again)).toEqual([]);
  });
});
