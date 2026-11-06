/**
 * Step 3 of the S1 acceptance scenario on the fake provider, once per acceptance path. The second person accepts the
 * invitation at the provider, and this server learns of it by:
 * - `webhook`: the provider's signed deliveries, posted to `POST /api/webhooks/clerk`;
 * - `first sign-in`: the person's first `GET /api/me` (the reconcile on sign-in);
 * - `periodic reconcile`: neither, so the company's next reconcile on a jobs tick, once the clock reaches its slot;
 * - `sync now`: neither, and an admin selects Sync now (`POST /api/companies/:companyId/sync`);
 * - `signed in already`: a person signed in before they accepted, whose session `GET /api/me` does not reconcile
 *   again, so `POST /api/me/reconcile` (what the `/accept-invitation` page calls once) brings the company in.
 */
import { expect } from 'vitest';
import { SELF_RECONCILE_INTERVAL_MS } from '../../../src/modules/identity/service.ts';
import { deliver } from '../identity/webhooks.ts';
import { type Founded, type Invited, membersOf } from './steps.ts';
import type { FakeTarget, SignedIn } from './target.ts';
import { type AcceptanceWorld, RECONCILE_MS } from './world.ts';

export const ACCEPTANCE_PATHS = [
  'webhook',
  'first sign-in',
  'periodic reconcile',
  'sync now',
  'signed in already',
] as const;
export type AcceptancePath = (typeof ACCEPTANCE_PATHS)[number];

/** The second person's name at the provider. */
export const SECOND_NAME = 'Second Person';

export interface Acceptance {
  readonly person: SignedIn;
  /**
   * The request ids the acceptance's audit rows (by the system) carry: the webhook deliveries' ids, the id of the
   * request that ran the reconcile, or none (null) for the jobs' periodic reconcile.
   */
  readonly auditRequestIds: readonly (string | null)[];
}

type FakeWorld = AcceptanceWorld<FakeTarget>;

/** The owner's member list does not show the person yet. */
async function expectNotMemberYet(w: FakeWorld, home: Founded, person: SignedIn): Promise<void> {
  expect((await membersOf(w, home)).map((member) => member.email)).not.toContain(person.email);
}

async function byWebhook(w: FakeWorld, home: Founded, invited: Invited): Promise<Acceptance> {
  const { fake } = w.target;
  fake.drainEvents();
  const person = await w.target.acceptBySignUp(invited.sent, 'second', SECOND_NAME);
  const events = fake.drainEvents();
  expect(events.map((event) => event.type)).toEqual(
    expect.arrayContaining(['user.upserted', 'membership.upserted', 'invitation.accepted']),
  );
  const receipts: unknown[] = [];
  for (const event of events) receipts.push((await deliver(w.t.app, fake.webhookFor(event))).body.status);
  expect(new Set(receipts)).toEqual(new Set(['processed']));
  // Linked by the user event: the session works on the company before the person's first GET /api/me.
  expect((await w.as(person)('GET', home.path())).status).toBe(200);
  return { person, auditRequestIds: events.map((event) => event.externalEventId) };
}

async function byFirstSignIn(w: FakeWorld, home: Founded, invited: Invited): Promise<Acceptance> {
  const person = await w.target.acceptBySignUp(invited.sent, 'second', SECOND_NAME);
  await expectNotMemberYet(w, home, person);
  expect((await w.as(person)('GET', home.path())).status).toBe(404);
  expect(await w.as(person, 'second-signs-in')('GET', '/api/me')).toMatchObject({
    status: 200,
    body: { memberships: [{ companyId: home.company.id, role: 'member', status: 'active' }] },
  });
  return { person, auditRequestIds: [w.requestId('second-signs-in')] };
}

async function byPeriodicReconcile(w: FakeWorld, home: Founded, invited: Invited): Promise<Acceptance> {
  const person = await w.target.acceptBySignUp(invited.sent, 'second', SECOND_NAME);
  // Both companies were reconciled when they turned active: none is due until its next slot.
  expect(await w.tick()).toMatchObject({ reconcile: { due: 0 }, failed: [] });
  await expectNotMemberYet(w, home, person);
  w.clock.advance(RECONCILE_MS);
  expect(await w.tick()).toMatchObject({ reconcile: { due: 2, reconciled: 2, failed: 0 }, failed: [] });
  return { person, auditRequestIds: [null] };
}

async function bySyncNow(w: FakeWorld, home: Founded, invited: Invited): Promise<Acceptance> {
  const person = await w.target.acceptBySignUp(invited.sent, 'second', SECOND_NAME);
  await expectNotMemberYet(w, home, person);
  const synced = await w.as(home.owner, 'owner-syncs')('POST', home.path('/sync'));
  expect(synced).toMatchObject({
    status: 200,
    body: { organization: 'linked', removed: 0, providerRemovals: 0 },
  });
  expect((synced.body as { changed: number }).changed).toBeGreaterThan(0);
  return { person, auditRequestIds: [w.requestId('owner-syncs')] };
}

async function bySelfReconcile(w: FakeWorld, home: Founded, invited: Invited): Promise<Acceptance> {
  const person = await w.target.signUp('second', SECOND_NAME);
  expect(await w.as(person)('GET', '/api/me')).toMatchObject({ status: 200, body: { memberships: [] } });
  // Signed in, they accept the invitation; their session was reconciled at its first call, so GET /api/me reads only.
  w.target.fake.accept(invited.sent.externalId, person.subject);
  expect(await w.as(person)('GET', '/api/me')).toMatchObject({ status: 200, body: { memberships: [] } });
  await expectNotMemberYet(w, home, person);
  const reconcile = (label?: string) => w.as(person, label)('POST', '/api/me/reconcile');
  expect(await reconcile('second-reconciles')).toMatchObject({
    status: 200,
    body: { memberships: [{ companyId: home.company.id, role: 'member', status: 'active' }] },
  });
  const again = await reconcile();
  expect(again).toMatchObject({ status: 429, body: { error: { code: 'rate_limited' } } });
  expect(again.headers.get('retry-after')).toBe(String(SELF_RECONCILE_INTERVAL_MS / 1000));
  w.clock.advance(SELF_RECONCILE_INTERVAL_MS);
  expect((await reconcile()).status).toBe(200);
  return { person, auditRequestIds: [w.requestId('second-reconciles')] };
}

const BY_PATH: Readonly<
  Record<AcceptancePath, (w: FakeWorld, home: Founded, invited: Invited) => Promise<Acceptance>>
> = {
  webhook: byWebhook,
  'first sign-in': byFirstSignIn,
  'periodic reconcile': byPeriodicReconcile,
  'sync now': bySyncNow,
  'signed in already': bySelfReconcile,
};

/** The second person accepts the invitation, and the server learns of it by `path`. */
export function acceptBy(path: AcceptancePath, w: FakeWorld, home: Founded, invited: Invited) {
  return BY_PATH[path](w, home, invited);
}
