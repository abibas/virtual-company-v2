import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  IDENTITY_EVENT_TYPES,
  type IdentityInboxEvent,
  IgnoredIdentityEvent,
  NormalizedIdentityEvent,
} from '@mwc/shared/identity';
import { IdentityProviderError } from '../errors.ts';
import type { WebhookRequest } from '../provider.ts';

export const FAKE_SIGNATURE_HEADER = 'x-fake-signature';

const KNOWN_TYPES: ReadonlySet<string> = new Set(IDENTITY_EVENT_TYPES);

/** The signature header's value for a body: an HMAC-SHA256 with the webhook secret. */
export function signFakeBody(secret: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

/** The event (or any JSON object, signed as it is) as a signed webhook delivery. */
export function fakeWebhookFor(
  event: NormalizedIdentityEvent | Readonly<Record<string, unknown>>,
  secret: string,
): WebhookRequest {
  const rawBody = JSON.stringify(event);
  return {
    headers: { 'content-type': 'application/json', [FAKE_SIGNATURE_HEADER]: signFakeBody(secret, rawBody) },
    rawBody,
  };
}

/**
 * A body of a type we do not use, as an `ignored` event when it says who sent it and its delivery id (`provider`,
 * `externalEventId`, `occurredAt`, as the normalized events do); null when it does not.
 */
function ignoredOf(body: unknown, type: unknown): IgnoredIdentityEvent | null {
  const parsed = IgnoredIdentityEvent.safeParse({
    ...(typeof body === 'object' && body !== null ? body : {}),
    type: 'ignored',
    data: { providerType: type },
  });
  return parsed.success ? parsed.data : null;
}

/**
 * Verifies a delivery's signature (header name in any case), then returns its normalized event, an `ignored` event
 * for a type we do not use, or null for a body with no type or delivery id; a bad signature rejects as
 * `unauthorized`, a bad body as `invalid`.
 */
export function parseFakeWebhook(request: WebhookRequest, secret: string): IdentityInboxEvent | null {
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
  if (typeof type !== 'string' || !KNOWN_TYPES.has(type)) return ignoredOf(body, type);
  const parsed = NormalizedIdentityEvent.safeParse(body);
  if (!parsed.success)
    throw new IdentityProviderError('invalid', `fake: bad ${type} event: ${parsed.error.message}`);
  return parsed.data;
}
