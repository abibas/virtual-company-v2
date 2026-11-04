import { companies } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { IdentityOutboxOp } from '@mwc/shared/enums';
import { IDENTITY_METADATA } from '@mwc/shared/identity';
import { LEVEL } from '@mwc/testkit';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvitationView, MemberView } from '../../../src/modules/members/schemas.ts';
import { OUTBOX_FIRST_DELAY_MS } from '../../../src/platform/jobs/outbox.ts';
import { type JobsDeps, type ModuleJobs, runJobsOnce } from '../../../src/platform/jobs/run.ts';
import { newSubject } from '../../fixtures/auth.ts';
import { addUser, auditOf, call, companyRow, createCompany, outboxOf } from '../../fixtures/companies.ts';
import { providerInvitationOf } from '../../fixtures/invitations.ts';
import { type JobsWorld, jobsWorld } from '../../fixtures/jobs.ts';
import { deliverEvents, failWrites, inboxRow } from '../../fixtures/webhooks.ts';

let w: JobsWorld;
beforeAll(async () => {
  w = await jobsWorld();
});
afterAll(() => w.t.close());

const tick = (deps: JobsDeps = w.jobs) => runJobsOnce(deps);
const NOTHING = { claimed: 0, done: 0, retry: 0, failed: 0, skipped: 0 };

/** A company created through the API by a new person, who then invites each email as a member. */
async function companyInviting(name: string, ...emails: string[]) {
  const creator = await addUser(w.t.db, w.fake);
  const company = await createCompany(w, creator.token, { name });
  const as = call(w, creator.token);
  const invitations: InvitationView[] = [];
  for (const email of emails) {
    const res = await as('POST', `/api/companies/${company.id}/invitations`, { email, role: 'member' });
    expect(res.status).toBe(201);
    invitations.push(res.body as InvitationView);
  }
  const members = async () =>
    ((await as('GET', `/api/companies/${company.id}/members`)).body as { members: MemberView[] }).members;
  return { company, as, invitations, members };
}

/** The invitee signs up at the fake and accepts the provider invitation that `invitation` follows. */
async function acceptAtFake(invitation: InvitationView): Promise<string> {
  const subject = newSubject('invitee');
  w.fake.createUser({ subject, email: invitation.email, displayName: `Invitee ${subject}` });
  w.fake.accept(await providerInvitationOf(w, invitation.id), subject);
  return subject;
}

describe('runJobsOnce on the fake provider', () => {
  it('takes a company from creation to an accepted invitation with nothing but ticks', async () => {
    const { company, invitations, members } = await companyInviting('Loop Co', 'invitee@loop.test');
    const [invitation] = invitations as [InvitationView];
    w.fake.failNext('createOrganization');
    // The organization is not made yet (the provider failed), so the invitation waits for it.
    expect(await tick()).toMatchObject({ idle: false, outbox: { claimed: 2, retry: 2 }, failed: [] });
    expect(await companyRow(w.t.db, company.id)).toMatchObject({
      status: 'provisioning',
      identityOrgId: null,
    });
    const waiting = (await outboxOf(w.t.db, company.id)).find((row) => row.op === 'invite');
    expect(waiting).toMatchObject({ status: 'pending', attempts: 1 });
    expect(waiting?.lastError).toContain('has no organization at the identity provider yet');
    // After the backoff: the organization, then the invitation, then the company's first reconcile.
    w.clock.advance(OUTBOX_FIRST_DELAY_MS);
    expect(await tick()).toMatchObject({
      outbox: { claimed: 2, done: 2 },
      events: { claimed: 0 },
      reconcile: { due: 1, reconciled: 1 },
      failed: [],
    });
    const linked = await companyRow(w.t.db, company.id);
    expect(linked?.status).toBe('active');
    expect(linked?.reconciledAt).toEqual(w.clock());
    const orgId = linked?.identityOrgId as string;
    expect((await w.fake.listInvitations(orgId, 'pending')).map((sent) => sent.email)).toEqual([
      invitation.email,
    ]);

    // The invitee accepts at the provider, with no webhook: the company's next reconcile brings them in.
    const subject = await acceptAtFake(invitation);
    expect(await tick()).toMatchObject({ outbox: NOTHING, reconcile: { due: 0 } });
    expect((await members()).find((member) => member.email === invitation.email)).toBeUndefined();
    w.clock.advance(w.jobs.reconcileIntervalMs);
    expect(await tick()).toMatchObject({ reconcile: { due: 1, reconciled: 1, failed: 0 } });
    expect((await members()).find((member) => member.email === invitation.email)).toMatchObject({
      displayName: `Invitee ${subject}`,
      role: 'member',
      status: 'active',
    });
    // The periodic reconcile's changes are audited by the system, with no request id, as the jobs' other rows: the
    // owner's membership linked to its provider membership on the first reconcile, then the acceptance.
    const accepted = (await auditOf(w.t.db, company.id)).filter((row) => row.actorKind === 'system');
    expect(
      new Set(accepted.map((row) => `${row.entityType} ${row.action} ${row.field} ${row.requestId}`)),
    ).toEqual(
      new Set([
        'company provision identityOrgId null',
        'company provision status null',
        'membership update externalMembershipId null',
        'membership update providerRole null',
        ...['externalMembershipId', 'grantedRole', 'invitationId', 'providerRole', 'role', 'status'].map(
          (field) => `membership activate ${field} null`,
        ),
        'invitation accept acceptedByUserId null',
        'invitation accept status null',
      ]),
    );
  });

  it('runs every op of the outbox through the one registry', async () => {
    const team = await companyInviting('Ops Co', 'kept@ops.test', 'dropped@ops.test');
    const [kept, dropped] = team.invitations as [InvitationView, InvitationView];
    await tick();
    const orgId = (await companyRow(w.t.db, team.company.id))?.identityOrgId as string;
    const subject = await acceptAtFake(kept);
    w.clock.advance(w.jobs.reconcileIntervalMs);
    await tick();
    const member = (await team.members()).find((one) => one.email === kept.email) as MemberView;
    expect(member.status).toBe('active');

    const path = `/api/companies/${team.company.id}`;
    expect((await team.as('PATCH', `${path}/members/${member.id}`, { role: 'admin' })).status).toBe(200);
    expect((await team.as('DELETE', `${path}/invitations/${dropped.id}`)).status).toBe(204);
    expect(await tick()).toMatchObject({ outbox: { claimed: 2, done: 2 } });
    const roleAt = async () => {
      for await (const one of w.fake.listOrganizationMembers(orgId)) if (one.subject === subject) return one;
    };
    expect((await roleAt())?.providerRole).toBe(w.fake.roles.toProvider('admin'));
    expect(await w.fake.listInvitations(orgId, 'pending')).toEqual([]);

    expect((await team.as('DELETE', `${path}/members/${member.id}`)).status).toBe(204);
    const confirmName = team.company.name;
    expect((await team.as('DELETE', path, { confirmName })).status).toBe(204);
    expect(await tick()).toMatchObject({ outbox: { claimed: 2, done: 2 }, failed: [] });
    expect(await w.fake.findOrganizationByMetadata(IDENTITY_METADATA.companyId, team.company.id)).toBeNull();

    const rows = await outboxOf(w.t.db, team.company.id);
    expect(new Set(rows.map((row) => row.op))).toEqual(new Set(IdentityOutboxOp.options));
    expect(rows.every((row) => row.status === 'done')).toBe(true);
  });

  it('retries a webhook event whose first try failed', async () => {
    w.fake.drainEvents();
    w.fake.createUser({ subject: newSubject('hooked'), email: 'hooked@events.test', displayName: 'Hooked' });
    const [event] = w.fake.drainEvents();
    const restore = await failWrites(w.t.db, 'users');
    expect(await deliverEvents(w, event ? [event] : [])).toEqual(['failed']);
    await restore();
    expect(await tick()).toMatchObject({ events: { claimed: 0 } });
    w.clock.advance(OUTBOX_FIRST_DELAY_MS);
    expect(await tick()).toMatchObject({ events: { claimed: 1, processed: 1, failed: 0, givenUp: 0 } });
    expect(await inboxRow(w.t.db, event?.externalEventId ?? '')).toMatchObject({
      status: 'processed',
      attempts: 2,
    });
  });
});

describe('runJobsOnce', () => {
  /** The world's deps with stub work that records the order the jobs run in. */
  function stubbed(overrides: Partial<ModuleJobs> = {}) {
    const order: string[] = [];
    const work: ModuleJobs = {
      outboxHandlers: {},
      retryEvents: vi.fn(async () => {
        order.push('events');
        return { claimed: 0, processed: 0, failed: 0, givenUp: 0 };
      }),
      reconcileCompany: vi.fn(async () => order.push('reconcile')),
      ...overrides,
    };
    return { deps: { ...w.jobs, work }, order };
  }
  // No company is due for a reconcile: each was reconciled just now.
  beforeEach(async () => {
    await rawDb(w.t.db).update(companies).set({ reconciledAt: w.clock() });
  });

  it('runs the outbox, then the event retry, then the reconcile', async () => {
    const { deps, order } = stubbed();
    const tally = await tick(deps);
    expect(tally).toEqual({
      idle: false,
      outbox: NOTHING,
      events: { claimed: 0, processed: 0, failed: 0, givenUp: 0 },
      reconcile: { due: 0, reconciled: 0, failed: 0, skipped: 0 },
      failed: [],
    });
    expect(order).toEqual(['events']);
  });

  it('logs a job that fails and still runs the others', async () => {
    const { deps } = stubbed({
      retryEvents: async () => {
        throw new Error('inbox unreadable');
      },
    });
    const before = w.t.logs.length;
    const tally = await tick(deps);
    expect(tally).toMatchObject({ idle: false, outbox: NOTHING, failed: ['events'] });
    expect(tally).not.toHaveProperty('events');
    expect(tally.reconcile).toBeDefined();
    const line = w.t.logs
      .slice(before)
      .find((one) => one.msg === 'jobs: a job failed; the next tick tries it again');
    expect(line).toMatchObject({ level: LEVEL.error, job: 'events', err: { message: 'inbox unreadable' } });
  });

  it('idles without an identity provider: the outbox rows wait, untouched, and nothing is logged', async () => {
    const { company } = await companyInviting('Idle Co', 'waits@idle.test');
    const { deps } = stubbed();
    const before = w.t.logs.length;
    expect(await tick({ ...deps, identity: undefined })).toEqual({ idle: true, failed: [] });
    expect(deps.work.retryEvents).not.toHaveBeenCalled();
    expect(w.t.logs.length).toBe(before);
    for (const row of await outboxOf(w.t.db, company.id)) {
      expect(row).toMatchObject({ status: 'pending', attempts: 0, lastError: null });
    }
  });
});
