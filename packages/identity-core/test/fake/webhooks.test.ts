import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FAKE_SIGNATURE_HEADER, FakeIdentityProvider } from '../../src/fake.ts';
import { providerError, sampleEvent } from '../fixtures/provider.ts';
import { buildScenario } from '../fixtures/world.ts';

describe('FakeIdentityProvider: webhooks', () => {
  const sign = (body: string, secret = 'fake-webhook-secret') =>
    `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

  it('round-trips every event of the scenario through webhookFor and parseWebhook', async () => {
    const { fake, events } = await buildScenario();
    for (const event of events) {
      const request = fake.webhookFor(event);
      expect(request.headers['content-type']).toBe('application/json');
      expect(request.headers[FAKE_SIGNATURE_HEADER]).toBe(sign(request.rawBody));
      expect(await fake.parseWebhook(request)).toEqual(event);
    }
  });

  it('reads the signature header whatever its case', async () => {
    const fake = new FakeIdentityProvider();
    const rawBody = JSON.stringify(sampleEvent);
    expect(await fake.parseWebhook({ headers: { 'X-Fake-Signature': sign(rawBody) }, rawBody })).toEqual(
      sampleEvent,
    );
  });

  it.each([
    ['a missing signature', (body: string) => ({ headers: {}, rawBody: body })],
    [
      'a wrong signature',
      (body: string) => ({ headers: { [FAKE_SIGNATURE_HEADER]: sign(`${body} `) }, rawBody: body }),
    ],
    [
      'a signature of another length',
      (body: string) => ({ headers: { [FAKE_SIGNATURE_HEADER]: 'sha256=00' }, rawBody: body }),
    ],
    [
      'another secret',
      (body: string) => ({ headers: { [FAKE_SIGNATURE_HEADER]: sign(body, 'other') }, rawBody: body }),
    ],
    [
      'a tampered body',
      (body: string) => ({
        headers: { [FAKE_SIGNATURE_HEADER]: sign(body) },
        rawBody: body.replace('u1', 'u2'),
      }),
    ],
  ])('rejects %s as unauthorized', async (_label, request) => {
    const fake = new FakeIdentityProvider();
    const error = await providerError(() => fake.parseWebhook(request(JSON.stringify(sampleEvent))));
    expect(error.code).toBe('unauthorized');
  });

  it('checks with its own secret', async () => {
    const fake = new FakeIdentityProvider({ webhookSecret: 's3' });
    const request = fake.webhookFor(sampleEvent);
    expect(request.headers[FAKE_SIGNATURE_HEADER]).toBe(sign(request.rawBody, 's3'));
    expect((await providerError(() => new FakeIdentityProvider().parseWebhook(request))).code).toBe(
      'unauthorized',
    );
  });

  it.each([
    ['a body that is not JSON', 'not json', 'invalid'],
    ['a known type with the wrong data', JSON.stringify({ ...sampleEvent, data: {} }), 'invalid'],
  ])('rejects %s as invalid', async (_label, rawBody, code) => {
    const fake = new FakeIdentityProvider();
    const error = await providerError(() =>
      fake.parseWebhook({ headers: { [FAKE_SIGNATURE_HEADER]: sign(rawBody) }, rawBody }),
    );
    expect(error.code).toBe(code);
  });

  it.each([
    ['an event type this product does not use', JSON.stringify({ ...sampleEvent, type: 'session.created' })],
    ['a body without a type', JSON.stringify({ hello: 'world' })],
    ['a JSON null', 'null'],
  ])('resolves null for %s', async (_label, rawBody) => {
    const fake = new FakeIdentityProvider();
    expect(
      await fake.parseWebhook({ headers: { [FAKE_SIGNATURE_HEADER]: sign(rawBody) }, rawBody }),
    ).toBeNull();
  });
});
