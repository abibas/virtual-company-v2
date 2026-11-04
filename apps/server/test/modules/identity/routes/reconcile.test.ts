import { createTestApp, getJson, LEVEL, postJson } from '@mwc/testkit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SELF_RECONCILE_INTERVAL_MS } from '../../../../src/modules/identity/service.ts';
import { type AuthWorld, authWorld, bearer, newSubject, seedApiKey } from '../../../fixtures/auth.ts';
import { auditOf } from '../../../fixtures/companies.ts';
import {
  acceptAtProvider,
  invitationRow,
  invite,
  memberWithEmail,
  runOutbox,
} from '../../../fixtures/invitations.ts';
import { addMember, membersCompany } from '../../../fixtures/members.ts';

/**
 * `POST /api/me/reconcile` (split from routes.test.ts along the route group): the sign-in reconcile at once, on the
 * person's request, for an invitation accepted while signed in; one turn per person every 10 seconds.
 */

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

const PATH = '/api/me/reconcile';
const reconcile = (token: string, app = w.t.app) => postJson(app, PATH, undefined, bearer(token));
const me = (token: string) => getJson(w.t.app, '/api/me', bearer(token));

/** A person who signed up at the fake and signed in here once (linked, their session reconciled). */
async function signedIn(label: string) {
  const subject = newSubject(label);
  const email = `${subject}@signed-in.test`;
  w.fake.createUser({ subject, email, displayName: `Signed In ${subject}` });
  const token = `fake:${subject};sid=sess_${subject}_laptop`;
  expect(await me(token)).toMatchObject({ status: 200, body: { memberships: [] } });
  return { subject, email, token };
}

describe('POST /api/me/reconcile', () => {
  it('brings in an invitation accepted while signed in, which GET /api/me in that session does not', async () => {
    const acme = await membersCompany(w);
    const person = await signedIn('already');
    const sent = await invite(w, acme, person.email, 'member');
    await runOutbox(w, acme.companyId);
    await acceptAtProvider(w, sent.id, person.subject);
    // The session was reconciled at its first call: GET /api/me reads only.
    expect(await me(person.token)).toMatchObject({ status: 200, body: { memberships: [] } });
    const res = await postJson(w.t.app, PATH, undefined, {
      ...bearer(person.token),
      'x-request-id': 'req-reconcile-me',
    });
    expect(res).toMatchObject({
      status: 200,
      body: {
        user: { email: person.email },
        memberships: [{ companyId: acme.companyId, role: 'member', status: 'active' }],
        session: { via: 'clerk', pending: false },
      },
    });
    expect(await memberWithEmail(w, acme, person.email)).toMatchObject({ role: 'member', status: 'active' });
    expect(await invitationRow(w, sent.id)).toMatchObject({ status: 'accepted' });
    expect(await me(person.token)).toMatchObject({ body: { memberships: [{ companyId: acme.companyId }] } });
    // What it changed is audited, by the system, with the request's id.
    const audited = (await auditOf(w.t.db, acme.companyId)).filter(
      (row) => row.requestId === 'req-reconcile-me',
    );
    expect(new Set(audited.map((row) => `${row.actorKind} ${row.entityType} ${row.action}`))).toEqual(
      new Set(['system membership activate', 'system invitation accept']),
    );
  });

  it('gives each person one turn every 10 seconds, with Retry-After, and keeps people apart', async () => {
    const ada = await signedIn('ada');
    const bob = await signedIn('bob');
    expect((await reconcile(ada.token)).status).toBe(200);
    const again = await reconcile(ada.token);
    expect(again).toMatchObject({ status: 429, body: { error: { code: 'rate_limited' } } });
    expect(again.headers.get('retry-after')).toBe(String(SELF_RECONCILE_INTERVAL_MS / 1000));
    // Another session of the same person shares the turn; another person has their own.
    expect((await reconcile(`fake:${ada.subject};sid=sess_phone`)).status).toBe(429);
    expect((await reconcile(bob.token)).status).toBe(200);
    w.clock.advance(4_000);
    expect((await reconcile(ada.token)).headers.get('retry-after')).toBe('6');
    w.clock.advance(6_000);
    expect((await reconcile(ada.token)).status).toBe(200);
  });

  it('links a person seen for the first time, also with a pending session', async () => {
    const subject = newSubject('first');
    w.fake.createUser({ subject, email: `${subject}@first.test`, displayName: 'First Time' });
    expect(await reconcile(`fake:${subject};pending`)).toMatchObject({
      status: 200,
      body: { user: { email: `${subject}@first.test` }, session: { pending: true } },
    });
  });

  it('refuses an API key (403), no or a bad credential (401) and a person the provider does not have', async () => {
    const acme = await membersCompany(w);
    const member = await addMember(w, acme, 'member');
    const { key } = await seedApiKey(w.t.db, { companyId: acme.companyId, principalId: member.principalId });
    expect(await reconcile(key)).toMatchObject({ status: 403, body: { error: { code: 'forbidden' } } });
    const anonymous = await postJson(w.t.app, PATH, undefined);
    expect(anonymous).toMatchObject({ status: 401, body: { error: { code: 'unauthenticated' } } });
    expect((await reconcile('garbage')).status).toBe(401);
    w.fake.createUser({ subject: 'ghost_reconcile', email: 'ghost-reconcile@x.test' });
    vi.spyOn(w.fake, 'getUser').mockResolvedValueOnce(null);
    expect(await reconcile('fake:ghost_reconcile')).toMatchObject({
      status: 401,
      body: { error: { code: 'unauthenticated' } },
    });
  });

  it('answers 403 for a person the provider deleted since their last sign-in', async () => {
    const person = await signedIn('deleted');
    vi.spyOn(w.fake, 'getUser').mockResolvedValueOnce(null);
    expect(await reconcile(person.token)).toMatchObject({
      status: 403,
      body: { error: { code: 'user_deactivated' } },
    });
  });

  it('serves the local state to a person seen before while the provider is away, and 503 to a new one', async () => {
    const acme = await membersCompany(w);
    const admin = await addMember(w, acme, 'admin');
    w.fake.failNext('getUser');
    expect(await reconcile(`fake:${admin.subject}`)).toMatchObject({
      status: 200,
      body: { memberships: [{ companyId: acme.companyId, role: 'admin' }] },
    });
    const warned = w.t.logs.find((l) => l.msg === 'sign-in reconcile failed; serving local state');
    expect(warned).toMatchObject({ level: LEVEL.warn, userId: admin.userId });
    const subject = newSubject('new');
    w.fake.createUser({ subject, email: `${subject}@new.test` });
    w.fake.failNext('getUser');
    expect(await reconcile(`fake:${subject}`)).toMatchObject({
      status: 503,
      body: { error: { code: 'identity_unavailable' } },
    });
  });

  it('answers 503 while sign-in is off', async () => {
    const off = await createTestApp({ db: w.t.db });
    expect(await reconcile('fake:anyone', off.app)).toMatchObject({
      status: 503,
      body: { error: { code: 'identity_not_configured' } },
    });
  });

  it('is in the OpenAPI document with the bearer scheme and its refusals', async () => {
    const doc = (await getJson(w.t.app, '/api/openapi.json')).body as {
      paths: Record<string, { post?: { security?: unknown; responses: Record<string, unknown> } }>;
    };
    const route = doc.paths[PATH]?.post;
    expect(route?.security).toEqual([{ bearer: [] }]);
    expect(Object.keys(route?.responses ?? {})).toEqual(['200', '401', '403', '429', '503']);
  });
});
