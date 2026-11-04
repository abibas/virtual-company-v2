import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  SVIX_ID_HEADER,
  SVIX_SIGNATURE_HEADER,
  SVIX_TIMESTAMP_HEADER,
  signedWebhook,
  svixSignature,
  testWebhookSecret,
} from '../src/webhooks.ts';

describe('svix-signed webhooks', () => {
  it('makes fresh whsec_ secrets of 24 random bytes', () => {
    const secret = testWebhookSecret();
    expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]{32}$/);
    expect(Buffer.from(secret.slice(6), 'base64')).toHaveLength(24);
    expect(testWebhookSecret()).not.toBe(secret);
  });

  it('signs "<id>.<timestamp>.<body>" with the decoded secret, as svix does', () => {
    const key = Buffer.from('test-key-bytes');
    const secret = `whsec_${key.toString('base64')}`;
    const expected = createHmac('sha256', key).update('msg_1.1700000000.{"a":1}').digest('base64');
    expect(svixSignature(secret, 'msg_1', 1_700_000_000, '{"a":1}')).toBe(`v1,${expected}`);
  });

  it('builds a delivery of an object as JSON, with the given id and timestamp', () => {
    const secret = testWebhookSecret();
    const delivery = signedWebhook({ type: 'user.deleted' }, secret, {
      id: 'msg_x',
      timestamp: 1_700_000_000,
    });
    expect(delivery.rawBody).toBe('{"type":"user.deleted"}');
    expect(delivery.headers).toEqual({
      'content-type': 'application/json',
      [SVIX_ID_HEADER]: 'msg_x',
      [SVIX_TIMESTAMP_HEADER]: '1700000000',
      [SVIX_SIGNATURE_HEADER]: svixSignature(secret, 'msg_x', 1_700_000_000, delivery.rawBody),
    });
  });

  it('defaults to a random id and the current time, and keeps a string body as it is', () => {
    const before = Math.floor(Date.now() / 1000);
    const delivery = signedWebhook('not json', testWebhookSecret());
    expect(delivery.rawBody).toBe('not json');
    expect(delivery.headers[SVIX_ID_HEADER]).toMatch(/^msg_[0-9a-f]{24}$/);
    expect(Number(delivery.headers[SVIX_TIMESTAMP_HEADER])).toBeGreaterThanOrEqual(before);
  });
});
