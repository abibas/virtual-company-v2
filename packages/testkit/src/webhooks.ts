import { createHmac, randomBytes } from 'node:crypto';

/**
 * svix-signed webhook deliveries, as Clerk sends them (Standard Webhooks): `svix-id`, `svix-timestamp`
 * (seconds) and `svix-signature: v1,<base64 HMAC-SHA256 of "<id>.<timestamp>.<body>">`, keyed with the
 * base64 part of a `whsec_` secret. Signed here independently of Clerk's SDK, so the connector's
 * verification is tested against a second implementation.
 */

export const SVIX_ID_HEADER = 'svix-id';
export const SVIX_TIMESTAMP_HEADER = 'svix-timestamp';
export const SVIX_SIGNATURE_HEADER = 'svix-signature';

/** A fresh signing secret for tests (`whsec_` + 24 random bytes in base64); never a real one. */
export function testWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('base64')}`;
}

/** The `svix-signature` value for a delivery: `v1,` and the base64 HMAC. */
export function svixSignature(secret: string, id: string, timestampSeconds: number, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const mac = createHmac('sha256', key).update(`${id}.${timestampSeconds}.${body}`).digest('base64');
  return `v1,${mac}`;
}

export interface SignedWebhookOptions {
  /** The delivery id (`svix-id`); a random `msg_...` by default. */
  readonly id?: string;
  /** Seconds since the epoch; now by default (pass an old one for a stale delivery). */
  readonly timestamp?: number;
}

/** A webhook request as the server receives it: lower-case headers and the raw body the signature covers. */
export interface SignedWebhook {
  readonly headers: Record<string, string>;
  readonly rawBody: string;
}

/** A svix-signed delivery of `payload` (an object, sent as JSON, or a raw string body). */
export function signedWebhook(
  payload: unknown,
  secret: string,
  options: SignedWebhookOptions = {},
): SignedWebhook {
  const rawBody = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const id = options.id ?? `msg_${randomBytes(12).toString('hex')}`;
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  return {
    headers: {
      'content-type': 'application/json',
      [SVIX_ID_HEADER]: id,
      [SVIX_TIMESTAMP_HEADER]: String(timestamp),
      [SVIX_SIGNATURE_HEADER]: svixSignature(secret, id, timestamp, rawBody),
    },
    rawBody,
  };
}
