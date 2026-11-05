import { userIdentities, users } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { createTestApp, fixedClock, getJson, postJson, type TestApp } from '@mwc/testkit';
import { signedWebhook, testWebhookSecret } from '@mwc/testkit/webhooks';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AuthWorld, authWorld, bearer, newSubject } from '../../../fixtures/auth.ts';
import { addMember, as, membersCompany } from '../../../fixtures/members.ts';
import { clerkEnvelope, clerkUserJson, clerkWebhookProvider, deliver } from '../../../fixtures/webhooks.ts';

/**
 * A person's name and photo (user profiles, Ihor's request of 2026-11-05) on every path that brings them from the
 * identity provider: the first sign-in, the reconcile on sign-in of a later session of a person seen before,
 * `POST /api/me/reconcile` (what the web calls right after the person saves them), and the `user.updated` webhook
 * with Clerk's own payloads; and `GET /api/me` and the member list showing them. A person who has not given a name
 * has none (null), never their email.
 */

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

const me = (token: string) => getJson(w.t.app, '/api/me', bearer(token));
const IHOR = { displayName: 'Ihor Herasko', imageUrl: 'https://img.test/ihor.png' };

describe("a person's name and photo from the identity provider", () => {
  it('gives a person who signed up without a name no name and no photo in GET /api/me', async () => {
    const subject = newSubject('nameless');
    w.fake.createUser({ subject, email: `${subject}@new.test`, displayName: null });
    expect(await me(`fake:${subject};sid=sess_${subject}`)).toMatchObject({
      status: 200,
      body: { user: { email: `${subject}@new.test`, displayName: null, imageUrl: null } },
    });
  });

  it('refreshes a person seen before at the reconcile of their next session; the member list shows it', async () => {
    const acme = await membersCompany(w);
    const person = await addMember(w, acme, 'member');
    const first = `fake:${person.subject};sid=sess_${person.subject}_laptop`;
    expect((await me(first)).body).toMatchObject({ user: { displayName: person.subject, imageUrl: null } });
    w.fake.updateUser(person.subject, IHOR);
    // That session was reconciled at its first call: GET /api/me in it reads only.
    expect((await me(first)).body).toMatchObject({ user: { displayName: person.subject, imageUrl: null } });
    const next = await me(`fake:${person.subject};sid=sess_${person.subject}_phone`);
    expect(next).toMatchObject({ status: 200, body: { user: IHOR } });
    const list = await as(w, acme.owner)('GET', acme.members);
    const members = (list.body as { members: { id: string }[] }).members;
    expect(members.find((member) => member.id === person.membershipId)).toMatchObject({
      ...IHOR,
      email: `${person.subject}@people.test`,
    });
  });

  it('takes a new name, and a photo taken away, at once with POST /api/me/reconcile', async () => {
    const subject = newSubject('self');
    const old = 'https://img.test/old.png';
    w.fake.createUser({ subject, email: `${subject}@self.test`, displayName: null, imageUrl: old });
    const token = `fake:${subject};sid=sess_${subject}`;
    expect((await me(token)).body).toMatchObject({ user: { displayName: null, imageUrl: old } });
    w.fake.updateUser(subject, { displayName: 'Ihor Herasko', imageUrl: null });
    expect(await postJson(w.t.app, '/api/me/reconcile', undefined, bearer(token))).toMatchObject({
      status: 200,
      body: { user: { displayName: 'Ihor Herasko', imageUrl: null } },
    });
    expect((await me(token)).body).toMatchObject({ user: { displayName: 'Ihor Herasko', imageUrl: null } });
  });
});

describe('the user webhooks with Clerk payloads', () => {
  const secret = testWebhookSecret();
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ clock: fixedClock(), identity: clerkWebhookProvider(secret) });
  });
  afterAll(() => t.close());

  const T = Date.UTC(2026, 10, 5, 12);
  const profileOf = async (subject: string) =>
    (
      await rawDb(t.db)
        .select({ displayName: users.displayName, imageUrl: users.imageUrl })
        .from(users)
        .innerJoin(userIdentities, eq(userIdentities.userId, users.id))
        .where(eq(userIdentities.subject, subject))
    )[0];
  /** Clerk's user JSON at `updated_at` T + `later` ms, with these fields. */
  const userJson = (id: string, later: number, fields: Record<string, unknown>) => ({
    ...clerkUserJson(id, `${id}@hooks.test`, T + later),
    ...fields,
  });
  const post = async (type: string, data: unknown) =>
    (await deliver(t.app, signedWebhook(clerkEnvelope(type, data), secret))).body;

  it("keeps a sign-up's generated image out, then takes the name and the photo the person sets, and its removal", async () => {
    const id = 'user_profile_hook';
    const defaultImage = { image_url: 'https://img.clerk.com/default', has_image: false };
    const nameless = userJson(id, 0, { first_name: null, last_name: null, ...defaultImage });
    expect(await post('user.created', nameless)).toEqual({ status: 'processed' });
    expect(await profileOf(id)).toEqual({ displayName: null, imageUrl: null });

    const photo = { image_url: 'https://img.clerk.com/ihor', has_image: true };
    const named = userJson(id, 1000, { first_name: ' Ihor', last_name: 'Herasko ', ...photo });
    expect(await post('user.updated', named)).toEqual({ status: 'processed' });
    expect(await profileOf(id)).toEqual({
      displayName: 'Ihor Herasko',
      imageUrl: 'https://img.clerk.com/ihor',
    });

    const removed = userJson(id, 2000, { first_name: 'Ihor', last_name: 'Herasko', ...defaultImage });
    expect(await post('user.updated', removed)).toEqual({ status: 'processed' });
    expect(await profileOf(id)).toEqual({ displayName: 'Ihor Herasko', imageUrl: null });
  });
});
