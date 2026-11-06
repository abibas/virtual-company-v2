import { userIdentities } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { createTestApp, FakeIdentityProvider, fixedClock, getJson, type TestApp } from '@mwc/testkit';
import { signedWebhook, testWebhookSecret } from '@mwc/testkit/webhooks';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WEBHOOK_MAX_BYTES } from '../../../../src/modules/identity/routes.ts';
import {
  clerkEnvelope,
  clerkUserJson,
  clerkWebhookProvider,
  deliver,
  inboxRow,
  inboxRows,
  WEBHOOK_PATH,
} from '../../../fixtures/identity/webhooks.ts';

const secret = testWebhookSecret();
const clock = fixedClock();
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ clock, identity: clerkWebhookProvider(secret) });
});
afterAll(() => t.close());

const nowSeconds = () => Math.floor(Date.now() / 1000);
const userCreated = (id: string) => clerkEnvelope('user.created', clerkUserJson(id, `${id}@hooks.test`));
const rowCount = async () => (await inboxRows(t.db)).length;

describe('POST /api/webhooks/clerk with svix signatures', () => {
  it('records a verified delivery once by its svix id and projects it at once', async () => {
    const delivery = signedWebhook(userCreated('user_hook_1'), secret, { id: 'msg_good' });
    expect(await deliver(t.app, delivery)).toEqual({ status: 200, body: { status: 'processed' } });
    expect(await inboxRow(t.db, 'msg_good')).toMatchObject({
      provider: 'clerk',
      type: 'user.upserted',
      status: 'processed',
      attempts: 1,
      lastError: null,
      nextAttemptAt: null,
      processedAt: clock(),
    });
    const [identity] = await rawDb(t.db)
      .select()
      .from(userIdentities)
      .where(eq(userIdentities.subject, 'user_hook_1'));
    expect(identity).toMatchObject({ provider: 'clerk', issuer: 'https://hooks-test.clerk.accounts.dev' });
  });

  it('answers a replay of the same svix id with 200 and does nothing', async () => {
    const delivery = signedWebhook(userCreated('user_hook_2'), secret, { id: 'msg_replayed' });
    expect((await deliver(t.app, delivery)).body).toEqual({ status: 'processed' });
    const before = await rowCount();
    expect(await deliver(t.app, delivery)).toEqual({ status: 200, body: { status: 'duplicate' } });
    expect(await rowCount()).toBe(before);
    expect(await inboxRow(t.db, 'msg_replayed')).toMatchObject({ status: 'processed', attempts: 1 });
  });

  it.each([
    [
      'a bad signature',
      (good: ReturnType<typeof signedWebhook>) => ({
        ...good,
        headers: { ...good.headers, 'svix-signature': 'v1,AAAA' },
      }),
    ],
    ['another secret', () => signedWebhook(userCreated('user_x'), testWebhookSecret())],
    [
      'no svix headers',
      (good: ReturnType<typeof signedWebhook>) => ({
        headers: { 'content-type': 'application/json' },
        rawBody: good.rawBody,
      }),
    ],
    [
      'a missing signature header',
      (good: ReturnType<typeof signedWebhook>) => {
        const { 'svix-signature': _gone, ...headers } = good.headers;
        return { ...good, headers };
      },
    ],
    [
      'a stale timestamp',
      () => signedWebhook(userCreated('user_x'), secret, { timestamp: nowSeconds() - 600 }),
    ],
    [
      'a future timestamp',
      () => signedWebhook(userCreated('user_x'), secret, { timestamp: nowSeconds() + 600 }),
    ],
    [
      'a tampered body',
      (good: ReturnType<typeof signedWebhook>) => ({
        ...good,
        rawBody: good.rawBody.replace('user_x', 'user_y'),
      }),
    ],
  ])('refuses %s with 400 invalid_signature and records nothing', async (_label, make) => {
    const before = await rowCount();
    const res = await deliver(t.app, make(signedWebhook(userCreated('user_x'), secret)));
    expect(res).toMatchObject({ status: 400, body: { error: { code: 'invalid_signature' } } });
    expect(await rowCount()).toBe(before);
  });

  it.each([
    ['a signed body that is not JSON', () => signedWebhook('not json', secret)],
    [
      'a signed event whose data does not fit',
      () => signedWebhook(clerkEnvelope('user.updated', { id: 'u' }), secret),
    ],
  ])('refuses %s with 400 invalid_payload and records nothing', async (_label, make) => {
    const before = await rowCount();
    expect(await deliver(t.app, make())).toMatchObject({
      status: 400,
      body: { error: { code: 'invalid_payload', requestId: expect.any(String) } },
    });
    expect(await rowCount()).toBe(before);
  });

  it('refuses a body over 512 KB with 413, with or without a length header, and records nothing', async () => {
    const before = await rowCount();
    const big = signedWebhook(clerkEnvelope('user.created', { pad: 'x'.repeat(WEBHOOK_MAX_BYTES) }), secret);
    expect(await deliver(t.app, big)).toMatchObject({
      status: 413,
      body: { error: { code: 'payload_too_large' } },
    });
    const declared = { ...big, headers: { ...big.headers, 'content-length': String(big.rawBody.length) } };
    expect((await deliver(t.app, declared)).status).toBe(413);
    expect(await rowCount()).toBe(before);
  });

  it('records an event type nobody projects as ignored, processed at once', async () => {
    const delivery = signedWebhook(clerkEnvelope('session.created', { id: 'sess_1' }), secret, {
      id: 'msg_sess',
    });
    expect(await deliver(t.app, delivery)).toEqual({ status: 200, body: { status: 'ignored' } });
    expect(await inboxRow(t.db, 'msg_sess')).toMatchObject({
      type: 'ignored',
      status: 'processed',
      attempts: 0,
      nextAttemptAt: null,
      processedAt: clock(),
      payload: { type: 'ignored', data: { providerType: 'session.created' }, externalEventId: 'msg_sess' },
    });
    expect((await deliver(t.app, delivery)).body).toEqual({ status: 'duplicate' });
  });
});

describe('POST /api/webhooks/clerk when webhooks are not configured', () => {
  it('answers 503 webhooks_not_configured without a signing secret or a provider, and stays healthy', async () => {
    const delivery = signedWebhook(userCreated('user_off'), secret);
    for (const options of [{ identity: clerkWebhookProvider() }, {}]) {
      const off = await createTestApp({ db: t.db, ...options });
      expect(await deliver(off.app, delivery)).toMatchObject({
        status: 503,
        body: { error: { code: 'webhooks_not_configured' } },
      });
      expect((await getJson(off.app, '/readyz')).status).toBe(200);
    }
    expect(await inboxRow(t.db, delivery.headers['svix-id'] as string)).toBeUndefined();
  });
});

describe('POST /api/webhooks/clerk with other provider outcomes', () => {
  it('acknowledges a verified delivery with nothing to record, and lets a provider failure through as 503', async () => {
    const fake = new FakeIdentityProvider({ clock });
    const app = (await createTestApp({ db: t.db, clock, identity: fake })).app;
    const before = await rowCount();
    expect(await deliver(app, fake.webhookFor({ hello: 'world' }))).toEqual({
      status: 200,
      body: { status: 'ignored' },
    });
    fake.failNext('parseWebhook');
    const failed = await deliver(app, fake.webhookFor({ hello: 'again' }));
    expect(failed).toMatchObject({ status: 503, body: { error: { code: 'identity_unavailable' } } });
    expect(await rowCount()).toBe(before);
  });

  it('is in the OpenAPI document without a bearer, with its refusals', async () => {
    const doc = (await getJson(t.app, '/api/openapi.json')).body as {
      paths: Record<string, { post?: { security?: unknown; responses: Record<string, unknown> } }>;
    };
    const route = doc.paths[WEBHOOK_PATH]?.post;
    expect(route?.security).toBeUndefined();
    expect(Object.keys(route?.responses ?? {})).toEqual(['200', '400', '413', '503']);
  });
});
