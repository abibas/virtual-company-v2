import { isIdentityProviderError, type WebhookRequest } from '@mwc/identity-core';
import { recordInboxEvent } from '../repo.ts';
import { type InboxDeps, type InboxTry, leaseUntil, processInboxEvent } from './events.ts';

/**
 * The webhook inbox's entry: a delivery verified by the identity provider (`parseWebhook`, the signature over the
 * exact body is the authentication), recorded once by its delivery id (Clerk: the svix id) and processed inline. A
 * replay is a no-op; an event type nobody projects is recorded and acknowledged; a processing failure is recorded on
 * the row for the retry loop and still acknowledged, so the provider does not send it again and again.
 */

/** What became of a verified delivery: projected, failed (the retry loop takes it), a replay, or ignored. */
export type WebhookStatus = 'processed' | 'failed' | 'duplicate' | 'ignored';

export type WebhookResult =
  | { readonly ok: true; readonly status: WebhookStatus }
  | {
      readonly ok: false;
      readonly status: 400 | 503;
      readonly code: 'invalid_signature' | 'invalid_payload' | 'webhooks_not_configured';
      readonly message: string;
    };

/** The inline try's outcome as the provider hears it; a try another one beat to the row found it processed. */
const AFTER_TRY: Readonly<Record<InboxTry, WebhookStatus>> = {
  processed: 'processed',
  skipped: 'processed',
  failed: 'failed',
  given_up: 'failed',
};

const NOT_CONFIGURED: WebhookResult = {
  ok: false,
  status: 503,
  code: 'webhooks_not_configured',
  message:
    'Webhooks are not configured on this server (no signing secret); reconcile keeps memberships current',
};

/**
 * Verifies, records and processes one delivery. Refused, writing nothing: no provider or one that cannot verify
 * webhooks (503 `webhooks_not_configured`), a missing or bad signature or a stale or future timestamp (400
 * `invalid_signature`), a signed body that is not a valid event (400 `invalid_payload`). Any other provider failure
 * rejects (the caller answers 5xx and the provider delivers again).
 */
export async function receiveWebhook(deps: InboxDeps, request: WebhookRequest): Promise<WebhookResult> {
  const provider = deps.identity;
  if (provider === undefined || !provider.capabilities.webhooks) return NOT_CONFIGURED;
  let event: Awaited<ReturnType<typeof provider.parseWebhook>>;
  try {
    event = await provider.parseWebhook(request);
  } catch (error) {
    if (!isIdentityProviderError(error) || (error.code !== 'unauthorized' && error.code !== 'invalid'))
      throw error;
    deps.logger?.warn({ code: error.code, reason: error.message }, 'webhook delivery refused');
    return error.code === 'unauthorized'
      ? {
          ok: false,
          status: 400,
          code: 'invalid_signature',
          message: 'The webhook signature does not verify',
        }
      : {
          ok: false,
          status: 400,
          code: 'invalid_payload',
          message: 'The signed webhook body is not a valid event',
        };
  }
  if (event === null) return { ok: true, status: 'ignored' };
  const now = deps.clock();
  const row = await recordInboxEvent(deps.db, { event, now, leaseUntil: leaseUntil(now) });
  if (row === undefined) return { ok: true, status: 'duplicate' };
  if (event.type === 'ignored') return { ok: true, status: 'ignored' };
  return { ok: true, status: AFTER_TRY[await processInboxEvent(deps, row)] };
}
