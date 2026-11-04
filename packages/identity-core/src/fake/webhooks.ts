import { createHmac, timingSafeEqual } from 'node:crypto';
import { IDENTITY_EVENT_TYPES, NormalizedIdentityEvent } from '@mwc/shared/identity';
import { IdentityProviderError } from '../errors.ts';
import type { WebhookRequest } from '../provider.ts';

export const FAKE_SIGNATURE_HEADER = 'x-fake-signature';

const KNOWN_TYPES: ReadonlySet<string> = new Set(IDENTITY_EVENT_TYPES);

/** The signature header's value for a body: an HMAC-SHA256 with the webhook secret. */
export function signFakeBody(secret: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

/** The event as a signed webhook delivery. */
export function fakeWebhookFor(event: NormalizedIdentityEvent, secret: string): WebhookRequest {
  const rawBody = JSON.stringify(event);
  return {
    headers: { 'content-type': 'application/json', [FAKE_SIGNATURE_HEADER]: signFakeBody(secret, rawBody) },
    rawBody,
  };
}

/**
 * Verifies a delivery's signature (header name in any case), then returns its normalized event, or null
 * for a type we do not use; a bad signature rejects as `unauthorized`, a bad body as `invalid`.
 */
export function parseFakeWebhook(request: WebhookRequest, secret: string): NormalizedIdentityEvent | null {
  const header = Object.entries(request.headers).find(
    ([name]) => name.toLowerCase() === FAKE_SIGNATURE_HEADER,
  )?.[1];
  const expected = Buffer.from(signFakeBody(secret, request.rawBody));
  const given = Buffer.from(header ?? '');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new IdentityProviderError('unauthorized', 'fake: bad webhook signature');
  }
  let body: unknown;
  try {
    body = JSON.parse(request.rawBody);
  } catch (error) {
    throw new IdentityProviderError('invalid', 'fake: webhook body is not JSON', { cause: error });
  }
  const type = (body as { type?: unknown } | null)?.type;
  if (typeof type !== 'string' || !KNOWN_TYPES.has(type)) return null;
  const parsed = NormalizedIdentityEvent.safeParse(body);
  if (!parsed.success)
    throw new IdentityProviderError('invalid', `fake: bad ${type} event: ${parsed.error.message}`);
  return parsed.data;
}
