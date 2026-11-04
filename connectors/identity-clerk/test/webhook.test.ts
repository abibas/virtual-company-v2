import { verifyWebhook } from '@clerk/backend/webhooks';
import { signedWebhook, testWebhookSecret } from '@mwc/testkit/webhooks';
import { describe, expect, it, vi } from 'vitest';
import type { VerifyWebhookFn } from '../src/backend/client.ts';
import { parseClerkWebhook } from '../src/webhook.ts';
import { T0 } from './fixtures/backend.ts';
import { envelope, membershipJson, userJson } from './fixtures/payloads.ts';

const secret = testWebhookSecret();
const verify = verifyWebhook as VerifyWebhookFn;
const nowSeconds = () => Math.floor(Date.now() / 1000);

async function code(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return (error as { code: string }).code;
  }
  return 'resolved';
}

describe('parseClerkWebhook with the real @clerk/backend verifier', () => {
  it('normalizes a signed delivery: the svix id is the event id, the envelope timestamp its time', async () => {
    const delivery = signedWebhook(envelope('organizationMembership.created', membershipJson()), secret, {
      id: 'msg_good',
    });
    expect(await parseClerkWebhook(verify, secret, delivery)).toEqual({
      provider: 'clerk',
      externalEventId: 'msg_good',
      occurredAt: T0 + 5,
      type: 'membership.upserted',
      data: {
        orgExternalId: 'org_1',
        subject: 'user_2',
        externalMembershipId: 'orgmem_1',
        providerRole: 'org:member',
        metadata: { mwc_invitation_id: 'inv-1' },
        updatedAt: T0,
      },
    });
  });

  it('falls back to the svix timestamp when the envelope has none', async () => {
    const sent = nowSeconds();
    const delivery = signedWebhook(envelope('user.updated', userJson(), null), secret, {
      timestamp: sent,
    });
    expect((await parseClerkWebhook(verify, secret, delivery))?.occurredAt).toBe(sent * 1000);
  });

  it('accepts a replayed delivery as the same event (the caller dedupes on the svix id)', async () => {
    const delivery = signedWebhook(envelope('user.updated', userJson()), secret, { id: 'msg_replay' });
    const first = await parseClerkWebhook(verify, secret, delivery);
    const again = await parseClerkWebhook(verify, secret, { ...delivery });
    expect(again).toEqual(first);
    expect(again?.externalEventId).toBe('msg_replay');
  });

  it('refuses a replay under another id or with another body as unauthorized', async () => {
    const delivery = signedWebhook(envelope('user.updated', userJson()), secret);
    const otherId = { ...delivery, headers: { ...delivery.headers, 'svix-id': 'msg_other' } };
    const otherBody = { ...delivery, rawBody: delivery.rawBody.replace('Ann', 'Eve') };
    expect(await code(parseClerkWebhook(verify, secret, otherId))).toBe('unauthorized');
    expect(await code(parseClerkWebhook(verify, secret, otherBody))).toBe('unauthorized');
  });

  it('refuses a bad signature, another secret, missing headers, and stale or future timestamps', async () => {
    const payload = envelope('user.updated', userJson());
    const good = signedWebhook(payload, secret);
    const cases = [
      { ...good, headers: { ...good.headers, 'svix-signature': 'v1,AAAA' } },
      signedWebhook(payload, testWebhookSecret()),
      { headers: { 'content-type': 'application/json' }, rawBody: good.rawBody },
      signedWebhook(payload, secret, { timestamp: nowSeconds() - 10 * 60 }),
      signedWebhook(payload, secret, { timestamp: nowSeconds() + 10 * 60 }),
    ];
    for (const request of cases)
      expect(await code(parseClerkWebhook(verify, secret, request))).toBe('unauthorized');
  });

  it('refuses a signed body that is not JSON as invalid', async () => {
    const delivery = signedWebhook('not json', secret);
    expect(await code(parseClerkWebhook(verify, secret, delivery))).toBe('invalid');
  });

  it('resolves an event type this product does not use as ignored, with the svix id and Clerk type', async () => {
    const delivery = signedWebhook(envelope('session.created', { id: 'sess_1' }), secret, { id: 'msg_sess' });
    expect(await parseClerkWebhook(verify, secret, delivery)).toEqual({
      provider: 'clerk',
      externalEventId: 'msg_sess',
      occurredAt: T0 + 5,
      type: 'ignored',
      data: { providerType: 'session.created' },
    });
  });

  it('refuses a signed event whose payload does not fit as invalid', async () => {
    const delivery = signedWebhook(envelope('user.updated', { id: 'user_1' }), secret);
    expect(await code(parseClerkWebhook(verify, secret, delivery))).toBe('invalid');
  });

  it('cannot verify anything without a signing secret: unavailable', async () => {
    const delivery = signedWebhook(envelope('user.updated', userJson()), secret);
    expect(await code(parseClerkWebhook(verify, undefined, delivery))).toBe('unavailable');
  });
});

describe('parseClerkWebhook: an envelope without a type', () => {
  it('resolves null: a verified delivery with nothing to record', async () => {
    const untyped = (async () => ({ data: {} })) as unknown as VerifyWebhookFn;
    const headers = { 'svix-id': 'msg_1', 'svix-timestamp': '1700000000' };
    expect(await parseClerkWebhook(untyped, 'whsec_x', { headers, rawBody: '{}' })).toBeNull();
  });
});

describe('parseClerkWebhook: what it hands the verifier', () => {
  it('a POST with the defined headers and the raw body, and the configured secret', async () => {
    const seen: { headers: Headers; body: string; secret: string }[] = [];
    const spy: VerifyWebhookFn = vi.fn(async (request: Request, options: { signingSecret: string }) => {
      seen.push({ headers: request.headers, body: await request.text(), secret: options.signingSecret });
      return { type: 'user.deleted', data: { id: 'user_1' } };
    });
    const event = await parseClerkWebhook(spy, 'whsec_x', {
      headers: { 'svix-id': 'msg_1', 'svix-timestamp': '1700000000', 'x-absent': undefined },
      rawBody: '{"raw":true}',
    });
    expect(event).toEqual({
      provider: 'clerk',
      externalEventId: 'msg_1',
      occurredAt: 1_700_000_000_000,
      type: 'user.deleted',
      data: { subject: 'user_1' },
    });
    expect(seen[0]?.body).toBe('{"raw":true}');
    expect(seen[0]?.secret).toBe('whsec_x');
    expect(seen[0]?.headers.has('x-absent')).toBe(false);
  });

  it('refuses an event without a svix id as invalid, and a non-Error failure as unauthorized', async () => {
    const ok: VerifyWebhookFn = async () => ({ type: 'user.deleted', data: { id: 'user_1' } });
    expect(await code(parseClerkWebhook(ok, 'whsec_x', { headers: {}, rawBody: '{}' }))).toBe('invalid');
    const unused: VerifyWebhookFn = async () => ({ type: 'session.created', data: {} });
    expect(await code(parseClerkWebhook(unused, 'whsec_x', { headers: {}, rawBody: '{}' }))).toBe('invalid');
    const odd: VerifyWebhookFn = () => Promise.reject('odd');
    expect(await code(parseClerkWebhook(odd, 'whsec_x', { headers: {}, rawBody: '{}' }))).toBe(
      'unauthorized',
    );
  });
});
