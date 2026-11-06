import { companies, invitations, memberships, principals, tenant, userIdentities, users } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { createTestApp, FAKE_ISSUER, getJson, LEVEL, seedCompany } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { auditOf, call } from '../../fixtures/companies/companies.ts';
import { acceptedInvitation } from '../../fixtures/identity/me.ts';
import {
  acceptAtProvider,
  DAY_MS,
  invite,
  memberWithEmail,
  outboxRows,
  runOutbox,
  signUp,
} from '../../fixtures/members/invitations.ts';
import { addMember, as, membersCompany } from '../../fixtures/members/members.ts';
import { type AuthWorld, addPerson, authWorld, bearer, seedApiKey } from '../../fixtures/platform/auth.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

const me = (token: string, app = w.t.app) => getJson(app, '/api/me', bearer(token));
const db = () => rawDb(w.t.db);
const identitiesOf = (subject: string) =>
  db().select().from(userIdentities).where(eq(userIdentities.subject, subject));
/** The company's audit rows of memberships and invitations: who, what and with which request id. */
const projectionAudit = async (companyId: string) =>
  (await auditOf(w.t.db, companyId))
    .filter((row) => row.entityType !== 'company')
    .map((row) => [row.actorKind, row.actorPrincipalId, row.entityType, row.action, row.requestId]);

describe('GET /api/me: reconcile on sign-in', () => {
  it('creates the person and links the membership from their accepted invitation', async () => {
    const { company, invitationId, subject, email } = await acceptedInvitation(w);
    const res = await me(`fake:${subject}`);
    expect(res).toMatchObject({
      status: 200,
      body: {
        user: { email, displayName: 'Bob Invitee', imageUrl: null },
        memberships: [
          {
            companyId: company.id,
            slug: company.slug,
            name: company.name,
            role: 'member',
            status: 'active',
            companyStatus: 'active',
            identityOrgId: company.identityOrgId,
          },
        ],
        session: { via: 'clerk', pending: false },
      },
    });
    const [identity] = await identitiesOf(subject);
    expect(identity).toMatchObject({ issuer: FAKE_ISSUER, provider: 'fake' });
    const userId = (res.body as { user: { id: string } }).user.id;
    expect(identity?.userId).toBe(userId);
    const [membership] = await db().select().from(memberships).where(eq(memberships.userId, userId));
    expect(membership).toMatchObject({
      companyId: company.id,
      invitationId,
      role: 'member',
      status: 'active',
    });
    const [invitation] = await db().select().from(invitations).where(eq(invitations.id, invitationId));
    expect(invitation).toMatchObject({ status: 'accepted', acceptedByUserId: userId });
    // Linked now: the company's routes know them.
    const probe = await getJson(
      w.t.app,
      `/api/companies/${company.id}/probe/member`,
      bearer(`fake:${subject}`),
    );
    expect(probe.status).toBe(200);
  });

  it('reads only on a second call in the same session, and reconciles again in a new session', async () => {
    const { subject } = await acceptedInvitation(w);
    const getUser = vi.spyOn(w.fake, 'getUser');
    const first = await me(`fake:${subject}`);
    const [before] = await db()
      .select()
      .from(users)
      .where(eq(users.primaryEmail, `${subject}@invitee.test`));
    w.clock.advance(1000);
    const second = await me(`fake:${subject}`);
    expect(second).toEqual({ ...first, headers: second.headers });
    expect(getUser).toHaveBeenCalledTimes(1);
    const [after] = await db()
      .select()
      .from(users)
      .where(eq(users.id, before?.id ?? ''));
    expect(after?.updatedAt).toEqual(before?.updatedAt);
    expect((await me(`fake:${subject};sid=sess_second_device`)).status).toBe(200);
    expect(getUser).toHaveBeenCalledTimes(2);
    getUser.mockRestore();
  });

  it('accepts a session with a pending task here, while company routes refuse it', async () => {
    const { company, subject } = await acceptedInvitation(w);
    expect(await me(`fake:${subject};pending`)).toMatchObject({
      status: 200,
      body: { session: { via: 'clerk', pending: true }, memberships: [{ companyId: company.id }] },
    });
    const probe = await getJson(
      w.t.app,
      `/api/companies/${company.id}/probe/viewer`,
      bearer(`fake:${subject};pending`),
    );
    expect(probe).toMatchObject({ status: 403, body: { error: { code: 'session_pending' } } });
  });

  it('survives concurrent first calls, in one server and in two', async () => {
    const one = await acceptedInvitation(w);
    const two = await acceptedInvitation(w);
    const other = await createTestApp({ db: w.t.db, clock: w.clock, identity: w.fake });
    const results = await Promise.all([
      me(`fake:${one.subject}`),
      me(`fake:${one.subject}`),
      me(`fake:${two.subject}`),
      me(`fake:${two.subject}`, other.app),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    for (const { subject, company } of [one, two]) {
      const linked = await identitiesOf(subject);
      expect(linked).toHaveLength(1);
      const rows = await db()
        .select()
        .from(memberships)
        .where(eq(memberships.userId, linked[0]?.userId ?? ''));
      expect(rows).toMatchObject([{ companyId: company.id, status: 'active' }]);
    }
  });
});

describe('GET /api/me: refusals and the provider away', () => {
  it('answers 401 when the provider has no such person', async () => {
    w.fake.createUser({ subject: 'ghost_me', email: 'ghost@x.test' });
    vi.spyOn(w.fake, 'getUser').mockResolvedValueOnce(null);
    expect(await me('fake:ghost_me')).toMatchObject({
      status: 401,
      body: { error: { code: 'unauthenticated' } },
    });
    expect(await identitiesOf('ghost_me')).toEqual([]);
  });

  it('answers 403 for a person the provider deleted since their last sign-in', async () => {
    const { company } = await seedCompany(w.t.db);
    const person = await addPerson(w.t.db, w.fake, company.id);
    vi.spyOn(w.fake, 'getUser').mockResolvedValueOnce(null);
    expect(await me(`fake:${person.subject}`)).toMatchObject({
      status: 403,
      body: { error: { code: 'user_deactivated' } },
    });
  });

  it('answers 503 for a new person while the provider is down, and nothing is linked', async () => {
    const { subject } = await acceptedInvitation(w);
    w.fake.failNext('getUser');
    expect(await me(`fake:${subject}`)).toMatchObject({
      status: 503,
      body: { error: { code: 'identity_unavailable' } },
    });
    expect(await identitiesOf(subject)).toEqual([]);
    expect((await me(`fake:${subject}`)).status).toBe(200);
  });

  it('serves the local state to a person seen before while the provider is down', async () => {
    const { company } = await seedCompany(w.t.db);
    const person = await addPerson(w.t.db, w.fake, company.id, { role: 'admin' });
    w.fake.failNext('getUser');
    const res = await me(`fake:${person.subject}`);
    expect(res).toMatchObject({
      status: 200,
      body: { memberships: [{ companyId: company.id, role: 'admin' }] },
    });
    const warned = w.t.logs.find((l) => l.msg === 'sign-in reconcile failed; serving local state');
    expect(warned).toMatchObject({ level: LEVEL.warn, userId: person.userId });
  });
});

/** Another membership for a user who exists: their own person principal in that company. */
async function join(
  companyId: string,
  userId: string,
  role: 'owner' | 'viewer',
  status: 'active' | 'removed',
) {
  const scoped = await tenant(w.t.db, companyId);
  const [principal] = await scoped.insert(principals, { kind: 'person' }).returning();
  const principalId = (principal as { id: string }).id;
  await scoped.insert(memberships, { principalId, userId, role, grantedRole: role, status });
}

describe('GET /api/me: what it lists', () => {
  it('lists memberships that are not removed, in companies that are not deleted', async () => {
    const [active, provisioning, suspended, deleted, removed] = await Promise.all(
      ['active', 'provisioning', 'suspended', 'deleted', 'removed'].map(
        async (name) => (await seedCompany(w.t.db, { name: `Company ${name}` })).company,
      ),
    );
    const person = await addPerson(w.t.db, w.fake, active?.id ?? '', { role: 'owner' });
    for (const company of [provisioning, suspended, deleted])
      await join(company?.id ?? '', person.userId, 'viewer', 'active');
    await join(removed?.id ?? '', person.userId, 'viewer', 'removed');
    for (const [company, status] of [
      [provisioning, 'provisioning'],
      [suspended, 'suspended'],
      [deleted, 'deleted'],
    ] as const) {
      await db()
        .update(companies)
        .set({ status })
        .where(eq(companies.id, company?.id ?? ''));
    }
    const res = await me(`fake:${person.subject}`);
    const listed = (
      res.body as { memberships: { name: string; companyStatus: string; identityOrgId: string | null }[] }
    ).memberships;
    expect(listed.map((m) => [m.name, m.companyStatus, m.identityOrgId])).toEqual([
      ['Company active', 'active', null],
      ['Company provisioning', 'provisioning', null],
      ['Company suspended', 'suspended', null],
    ]);
  });

  it('shows an API key only its own company, and says so in the session', async () => {
    const home = await seedCompany(w.t.db, { name: 'Home' });
    const away = await seedCompany(w.t.db, { name: 'Away' });
    const person = await addPerson(w.t.db, w.fake, home.company.id, { role: 'member' });
    await join(away.company.id, person.userId, 'owner', 'active');
    const { key } = await seedApiKey(w.t.db, { companyId: home.company.id, principalId: person.principalId });
    const getUser = vi.spyOn(w.fake, 'getUser');
    expect(await me(key)).toMatchObject({
      status: 200,
      body: {
        user: { id: person.userId },
        memberships: [{ companyId: home.company.id, name: 'Home', role: 'member' }],
        session: { via: 'api_key', pending: false },
      },
    });
    expect(getUser).not.toHaveBeenCalled();
    const all = await me(`fake:${person.subject}`);
    expect(all.body).toMatchObject({ memberships: [{ name: 'Away', role: 'owner' }, { name: 'Home' }] });
    getUser.mockRestore();
  });
});

describe('acceptance on sign-in (GET /api/me)', () => {
  it('activates the invitee with the role of our invitation the first time they sign in', async () => {
    const acme = await membersCompany(w);
    const sent = await invite(w, acme, 'signs-in@x.test', 'admin');
    await runOutbox(w, acme.companyId);
    const person = signUp(w, 'signs-in@x.test');
    await acceptAtProvider(w, sent.id, person.subject);
    expect(await memberWithEmail(w, acme, 'signs-in@x.test')).toBeUndefined();
    const signedIn = await getJson(w.t.app, '/api/me', {
      ...bearer(`fake:${person.subject}`),
      'x-request-id': 'req-sign-in',
    });
    expect(signedIn).toMatchObject({
      status: 200,
      body: { memberships: [{ companyId: acme.companyId, role: 'admin', status: 'active' }] },
    });
    expect(await memberWithEmail(w, acme, 'signs-in@x.test')).toMatchObject({
      role: 'admin',
      status: 'active',
    });
    // What the reconcile changed is audited, by the system, with the sign-in's request id: the person placed on the
    // org chart too (S2.4).
    const audited = (await projectionAudit(acme.companyId)).filter((row) => row[4] === 'req-sign-in');
    expect(new Set(audited.map((row) => row.slice(0, 4).join(' ')))).toEqual(
      new Set(['system  membership activate', 'system  invitation accept', 'system  org_position create']),
    );
  });

  it('activates nobody from an invitation accepted after its expiry', async () => {
    const acme = await membersCompany(w);
    const sent = await invite(w, acme, 'expired-sign-in@x.test', 'member');
    await runOutbox(w, acme.companyId);
    w.clock.advance(15 * DAY_MS);
    const person = signUp(w, 'expired-sign-in@x.test');
    await acceptAtProvider(w, sent.id, person.subject);
    expect(await me(`fake:${person.subject}`)).toMatchObject({ status: 200, body: { memberships: [] } });
    expect(await memberWithEmail(w, acme, 'expired-sign-in@x.test')).toBeUndefined();
  });
});

describe('POST /api/companies/:companyId/sync', () => {
  const sync = (companyId: string) => `/api/companies/${companyId}/sync`;

  it('reconciles the company now: an accepted invitation becomes an active member', async () => {
    const acme = await membersCompany(w);
    const sent = await invite(w, acme, 'sync-now@x.test', 'viewer');
    await runOutbox(w, acme.companyId);
    const person = signUp(w, 'sync-now@x.test');
    await acceptAtProvider(w, sent.id, person.subject);
    const res = await as(w, acme.owner, 'req-sync-now')('POST', sync(acme.companyId));
    expect(res).toMatchObject({
      status: 200,
      body: { organization: 'linked', members: 2, invitations: 1, removed: 0, providerRemovals: 0 },
    });
    expect(await memberWithEmail(w, acme, 'sync-now@x.test')).toMatchObject({
      role: 'viewer',
      status: 'active',
    });
    expect(await outboxRows(w, acme.companyId, 'remove_member')).toEqual([]);
    // The acceptance it projected is audited by the system, with Sync now's request id.
    const audited = (await projectionAudit(acme.companyId)).filter((row) => row[3] !== 'create');
    expect(audited.length).toBeGreaterThan(0);
    expect(audited.every((row) => row[0] === 'system' && row[1] === null && row[4] === 'req-sync-now')).toBe(
      true,
    );
    expect(audited.map((row) => `${row[2]} ${row[3]}`)).toEqual(
      expect.arrayContaining(['membership activate', 'invitation accept']),
    );
  });

  it('is a 401, a 403 below admin, a 404 for an outsider, and a 503 while the provider is away', async () => {
    const acme = await membersCompany(w);
    expect((await call(w, undefined)('POST', sync(acme.companyId))).status).toBe(401);
    const member = await addMember(w, acme, 'member');
    expect(await as(w, member)('POST', sync(acme.companyId))).toMatchObject({
      status: 403,
      body: { error: { code: 'forbidden' } },
    });
    const admin = await addMember(w, acme, 'admin');
    expect((await as(w, admin)('POST', sync(acme.companyId))).status).toBe(200);
    const other = await membersCompany(w);
    expect((await as(w, other.owner)('POST', sync(acme.companyId))).status).toBe(404);
    w.fake.failNext('listOrganizationMembers');
    expect(await as(w, acme.owner)('POST', sync(acme.companyId))).toMatchObject({
      status: 503,
      body: { error: { code: 'identity_unavailable' } },
    });
    const provisioning = await membersCompany(w, { provisioning: true });
    expect(await as(w, provisioning.owner)('POST', sync(provisioning.companyId))).toMatchObject({
      status: 200,
      body: { organization: 'pending' },
    });
  });
});
