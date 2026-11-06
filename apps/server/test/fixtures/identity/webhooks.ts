/**
 * The webhook inbox tests' helpers: deliveries posted to `POST /api/webhooks/clerk` (the fake's signed events, or
 * raw svix-signed requests), raw reads of the inbox rows, a Clerk provider whose real `parseWebhook` checks svix
 * signatures (`clerkWebhookProvider`, its Backend API never called), Clerk payloads, and a switch that makes every
 * write to one table fail (a CHECK added `not valid`, so old rows stay) for processing failures on both drivers.
 */
import { randomBytes } from 'node:crypto';
import { type DbHandle, identityEvents } from '@mwc/db';
import { queryRows, rawDb } from '@mwc/db/system';
import { clerkBackend, clerkIdentityProvider } from '@mwc/identity-clerk';
import type { WebhookRequest } from '@mwc/identity-core';
import type { NormalizedIdentityEvent } from '@mwc/shared/identity';
import type { App } from '@mwc/testkit';
import { asc, eq, sql } from 'drizzle-orm';
import type { AuthWorld } from '../platform/auth.ts';

export const WEBHOOK_PATH = '/api/webhooks/clerk';

/** Posts one delivery to the webhook route, exactly as received (headers and the raw body). */
export async function deliver(app: App, request: WebhookRequest) {
  const headers = Object.fromEntries(
    Object.entries(request.headers).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const res = await app.request(WEBHOOK_PATH, { method: 'POST', headers, body: request.rawBody });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** Delivers the fake's signed copy of each event, in order; returns the receipts' statuses. */
export async function deliverEvents(w: AuthWorld, events: readonly NormalizedIdentityEvent[]) {
  const statuses: unknown[] = [];
  for (const event of events) statuses.push((await deliver(w.t.app, w.fake.webhookFor(event))).body.status);
  return statuses;
}

/** A copy of an event under a new delivery id (and with `patch` merged into its data). */
export function redelivered<E extends NormalizedIdentityEvent>(event: E, patch: Partial<E['data']> = {}): E {
  return {
    ...event,
    externalEventId: `late_${randomBytes(4).toString('hex')}`,
    data: { ...event.data, ...patch },
  };
}

/** Every inbox row, oldest first. */
export const inboxRows = (db: DbHandle) =>
  rawDb(db).select().from(identityEvents).orderBy(asc(identityEvents.createdAt), asc(identityEvents.id));

/** The inbox row of one delivery id. */
export const inboxRow = async (db: DbHandle, externalEventId: string) =>
  (
    await rawDb(db).select().from(identityEvents).where(eq(identityEvents.externalEventId, externalEventId))
  )[0];

/**
 * Makes every insert and update of `table` fail (a `check (false)` added `not valid`) until the returned function
 * runs. The constraint is named after the table, so one test holds it at a time.
 */
export async function failWrites(db: DbHandle, table: 'memberships' | 'audit_log' | 'users') {
  const name = sql.identifier(`test_fail_${table}`);
  await queryRows(
    db,
    sql`alter table ${sql.identifier(table)} add constraint ${name} check (false) not valid`,
  );
  return async () => {
    await queryRows(db, sql`alter table ${sql.identifier(table)} drop constraint ${name}`);
  };
}

const HOST = 'hooks-test.clerk.accounts.dev';
const SECRET_KEY = `sk_test_${'H00ks'.repeat(5)}`;

/** The Clerk connector with this signing secret (none: webhooks off); only its webhook verification is used. */
export function clerkWebhookProvider(signingSecret?: string) {
  return clerkIdentityProvider(
    {
      secretKey: SECRET_KEY,
      publishableKey: `pk_test_${Buffer.from(`${HOST}$`).toString('base64')}`,
      issuer: `https://${HOST}`,
      frontendApi: HOST,
      ...(signingSecret === undefined ? {} : { webhookSigningSecret: signingSecret }),
    },
    clerkBackend(SECRET_KEY),
  );
}

/** A Clerk event envelope as Clerk sends it (snake_case data, the time in ms). */
export function clerkEnvelope(type: string, data: unknown, timestamp = Date.now()) {
  return { type, object: 'event', data, timestamp, instance_id: 'ins_hooks' };
}

/** Clerk's `user` JSON, as a `user.created` delivery carries it. */
export function clerkUserJson(id: string, email: string, updatedAt = Date.now()) {
  return {
    object: 'user',
    id,
    first_name: 'Hook',
    last_name: 'Person',
    username: null,
    image_url: '',
    has_image: false,
    primary_email_address_id: 'idn_1',
    email_addresses: [{ object: 'email_address', id: 'idn_1', email_address: email }],
    updated_at: updatedAt,
  };
}
