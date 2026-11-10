import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { joinCompany } from '../../fixtures/companies/companies.ts';
import { as, type MembersCompany, membersCompany } from '../../fixtures/members/members.ts';
import { inboxOf, notificationsPath, rowsFor } from '../../fixtures/notifications.ts';
import { placedMember, positionPath } from '../../fixtures/org.ts';
import { type AuthWorld, authWorld, type Person } from '../../fixtures/platform/auth.ts';

// `/api/companies/:companyId/notifications` (S2.9): every active member reads and marks only their own, in that company
// only, a page at a time; and turns their emails on or off.

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

/** `count` moves of `who` between the owner and `other`: one `manager_changed` notice each for them. */
async function moves(company: MembersCompany, who: Person, other: Person, count: number) {
  for (let i = 0; i < count; i++) {
    const to = i % 2 === 0 ? other.principalId : company.owner.principalId;
    const res = await as(w, company.owner)('PUT', positionPath(company, who.principalId), {
      reportsToPrincipalId: to,
    });
    expect(res.status).toBe(200);
  }
}

describe('GET /notifications', () => {
  it('pages the caller’s own, newest first, with the unread count; a viewer reads theirs too', async () => {
    const company = await membersCompany(w);
    const viewer = await placedMember(w, company, 'viewer');
    const other = await placedMember(w, company, 'member');
    await moves(company, viewer, other, 3);
    const first = await inboxOf(w, company, viewer, '?limit=2');
    expect(first.unreadCount).toBe(3);
    expect(first.notifications).toHaveLength(2);
    expect(first.nextBefore).toBe(first.notifications[1]?.id);
    const second = await inboxOf(w, company, viewer, `?limit=2&before=${first.nextBefore}`);
    expect(second.notifications).toHaveLength(1);
    expect(second.nextBefore).toBeNull();
    const ids = [...first.notifications, ...second.notifications].map((notice) => notice.id);
    expect([...ids].sort().reverse()).toEqual(ids);
    expect((await inboxOf(w, company, viewer)).notifications).toHaveLength(3);
    // The other member holds only their own: two "now reports to you" and one "no longer".
    expect((await inboxOf(w, company, other)).notifications.map((notice) => notice.kind)).toEqual([
      'report_added',
      'report_removed',
      'report_added',
    ]);
  });

  it('refuses a bad page and an outsider', async () => {
    const company = await membersCompany(w);
    expect((await as(w, company.owner)('GET', notificationsPath(company, '?before=nope'))).status).toBe(400);
    expect((await as(w, company.owner)('GET', notificationsPath(company, '?limit=0'))).status).toBe(400);
    const outsider = await membersCompany(w);
    expect((await as(w, outsider.owner)('GET', notificationsPath(company))).status).toBe(404);
  });

  it('keeps each company’s apart for someone in two companies', async () => {
    const first = await membersCompany(w);
    const second = await membersCompany(w);
    const mia = await placedMember(w, first, 'member');
    const other = await placedMember(w, first, 'member');
    await joinCompany(w.t.db, second.companyId, mia.userId, 'member');
    await moves(first, mia, other, 1);
    expect((await inboxOf(w, first, mia)).unreadCount).toBe(1);
    expect(await inboxOf(w, second, mia)).toEqual({ notifications: [], unreadCount: 0, nextBefore: null });
    // Marking all read in the second company leaves the first one's unread.
    const read = await as(w, mia)('POST', notificationsPath(second, '/read'), { all: true });
    expect(read).toMatchObject({ status: 200, body: { unreadCount: 0 } });
    expect((await inboxOf(w, first, mia)).unreadCount).toBe(1);
  });
});

describe('POST /notifications/read', () => {
  it('marks the caller’s own by id or all, and never another’s', async () => {
    const company = await membersCompany(w);
    const mia = await placedMember(w, company, 'member');
    const other = await placedMember(w, company, 'member');
    await moves(company, mia, other, 3);
    const [newest, , oldest] = (await inboxOf(w, company, mia)).notifications;
    const theirs = (await inboxOf(w, company, other)).notifications.map((notice) => notice.id);
    const marked = await as(w, mia)('POST', notificationsPath(company, '/read'), {
      ids: [newest?.id, ...theirs],
    });
    expect(marked).toMatchObject({ status: 200, body: { unreadCount: 2 } });
    expect((await inboxOf(w, company, other)).unreadCount).toBe(3);
    const after = (await inboxOf(w, company, mia)).notifications;
    expect(after[0]?.readAt).toBe(w.clock().toISOString());
    expect(after[2]?.readAt).toBeNull();
    const all = await as(w, mia)('POST', notificationsPath(company, '/read'), { all: true });
    expect(all).toMatchObject({ status: 200, body: { unreadCount: 0 } });
    const rows = await rowsFor(w.t.db, company.companyId, mia.principalId);
    expect(rows.find((row) => row.id === oldest?.id)?.readAt).toEqual(w.clock());
  });

  it('refuses a body that is neither ids nor all', async () => {
    const company = await membersCompany(w);
    const path = notificationsPath(company, '/read');
    for (const body of [{}, { ids: [] }, { ids: ['nope'] }, { all: false }]) {
      expect((await as(w, company.owner)('POST', path, body)).status).toBe(400);
    }
  });
});

describe('/notifications/settings', () => {
  it('has email on by default, and keeps each person’s choice per company', async () => {
    const company = await membersCompany(w);
    const mia = await placedMember(w, company, 'viewer');
    const path = notificationsPath(company, '/settings');
    expect(await as(w, mia)('GET', path)).toMatchObject({
      status: 200,
      body: { email: true, serverEmail: 'off' },
    });
    expect(await as(w, mia)('PUT', path, { email: false })).toMatchObject({
      status: 200,
      body: { email: false },
    });
    expect(await as(w, mia)('GET', path)).toMatchObject({ body: { email: false } });
    expect(await as(w, company.owner)('GET', path)).toMatchObject({ body: { email: true } });
    expect(await as(w, mia)('PUT', path, { email: true })).toMatchObject({ body: { email: true } });
    expect((await as(w, mia)('PUT', path, { email: 'yes' })).status).toBe(400);
  });
});
