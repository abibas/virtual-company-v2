import { memberships, tenant } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { membersRepo } from '../../../../src/modules/members/repo.ts';
import {
  createInvitation,
  resendInvitation,
  revokeInvitation,
} from '../../../../src/modules/members/service/invitations.ts';
import { type AuthWorld, authWorld } from '../../../fixtures/auth.ts';
import { auditFields, auditOf } from '../../../fixtures/companies.ts';
import { DAY_MS, invitationRow, invitationsPath, invite, outboxRows } from '../../../fixtures/invitations.ts';
import { addMember, as, membersCompany } from '../../../fixtures/members.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

const post = (company: Awaited<ReturnType<typeof membersCompany>>, email: string, role = 'member') =>
  as(w, company.owner)('POST', invitationsPath(company), { email, role });

describe('creating an invitation under the company lock', () => {
  it('stores the expiry of overdue pending invitations first (a system change), so their email is free again', async () => {
    const company = await membersCompany(w);
    const old = await invite(w, company, 'returning@x.test', 'viewer');
    const fresh = await invite(w, company, 'other@x.test');
    w.clock.advance(14 * DAY_MS);
    const again = await invite(w, company, 'returning@x.test', 'admin');
    expect(again.id).not.toBe(old.id);
    expect(await invitationRow(w, old.id)).toMatchObject({ status: 'expired' });
    // Every overdue one of the company, not only the same email's.
    expect(await invitationRow(w, fresh.id)).toMatchObject({ status: 'expired' });
    const expiries = auditFields(await auditOf(w.t.db, company.companyId)).filter(
      (row) => row.action === 'expire',
    );
    expect(expiries).toEqual(
      [old.id, fresh.id].map((entityId) =>
        expect.objectContaining({
          actorKind: 'system',
          actorPrincipalId: null,
          requestId: null,
          entityType: 'invitation',
          entityId,
          field: 'status',
          oldValue: 'pending',
          newValue: 'expired',
        }),
      ),
    );
  });

  it("counts every member the list shows (a suspended one too), but not a removed member's email", async () => {
    const company = await membersCompany(w);
    const suspended = await addMember(w, company, 'member', 'suspended');
    const removed = await addMember(w, company, 'admin', 'removed');
    expect(await post(company, `${suspended.subject}@people.test`)).toMatchObject({
      status: 409,
      body: { error: { code: 'already_member' } },
    });
    expect((await post(company, `${removed.subject}@people.test`, 'admin')).status).toBe(201);
  });

  it('keeps one pending invitation per email when two admins invite the same email at the same time', async () => {
    const company = await membersCompany(w);
    const admin = await addMember(w, company, 'admin');
    const body = { email: 'race@x.test', role: 'member' };
    const results = await Promise.all([
      as(w, company.owner)('POST', invitationsPath(company), body),
      as(w, admin)('POST', invitationsPath(company), body),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(await outboxRows(w, company.companyId, 'invite')).toHaveLength(1);
  });

  it('refuses an acting member who is no longer active (403) and writes nothing', async () => {
    const company = await membersCompany(w);
    const admin = await addMember(w, company, 'admin');
    await rawDb(w.t.db)
      .update(memberships)
      .set({ status: 'removed' })
      .where(eq(memberships.id, admin.membershipId));
    const t = await tenant(w.t.db, company.companyId);
    const result = await createInvitation(w.t.db, membersRepo(), t, {
      actorId: admin.membershipId,
      email: 'nobody@x.test',
      role: 'member',
      requestId: 'req',
      now: w.clock(),
      redirectUrl: 'http://localhost/accept-invitation',
    });
    expect(result).toMatchObject({ ok: false, status: 403, code: 'forbidden' });
    expect(await outboxRows(w, company.companyId, 'invite')).toEqual([]);
    const sent = await invite(w, company, 'still-here@x.test');
    const change = { actorId: admin.membershipId, invitationId: sent.id, requestId: 'req', now: w.clock() };
    const redirectUrl = 'http://localhost/accept-invitation';
    expect(await resendInvitation(membersRepo(), t, { ...change, redirectUrl })).toMatchObject({
      status: 403,
    });
    expect(await revokeInvitation(membersRepo(), t, change)).toMatchObject({ status: 403 });
    expect(await invitationRow(w, sent.id)).toMatchObject({ status: 'pending' });
  });
});
