import { createRoute } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { authn } from '../../platform/auth/authn.ts';
import { companyRoute } from '../../platform/auth/membership.ts';
import type { AppEnv, ServerDeps } from '../../platform/env.ts';
import { BEARER_SCHEME, jsonResponse } from '../../platform/http/docs.ts';
import { errorResponse as error, errorJson } from '../../platform/http/errors.ts';
import { newRouter } from '../../platform/http/router.ts';
import { CompanySyncSchema, MeSchema, SyncParamsSchema, WebhookReceiptSchema } from './schemas.ts';
import { reconcileCompany } from './service/sync.ts';
import { receiveWebhook } from './service/webhooks.ts';
import { type ChartDeps, meService } from './service.ts';

/** The largest webhook body read; Clerk's deliveries are a few KB. */
export const WEBHOOK_MAX_BYTES = 512 * 1024;

const meRoute = (deps: ServerDeps) =>
  createRoute({
    method: 'get',
    path: '/api/me',
    tags: ['identity'],
    summary: 'The caller: their user, memberships and session; links a person on sign-in',
    description:
      'Accepts a Clerk session token (also one with a pending task) or a personal API key. The first call of ' +
      'a session reconciles the person and their memberships with the identity provider.',
    security: [{ [BEARER_SCHEME]: [] }],
    middleware: authn(deps, { allowPending: true }),
    responses: {
      200: { description: 'The caller', content: { 'application/json': { schema: MeSchema } } },
      401: error('No credential, or one that is not valid (`unauthenticated`)'),
      403: error('A deactivated account (`user_deactivated`)'),
      503: error(
        'Sign-in is off (`identity_not_configured`) or the provider is away (`identity_unavailable`)',
      ),
    },
  });

const reconcileMeRoute = (deps: ServerDeps) =>
  createRoute({
    method: 'post',
    path: '/api/me/reconcile',
    tags: ['identity'],
    summary: 'Reconcile me now: bring my memberships in line with the identity provider at once',
    description:
      'For a signed-in Clerk session (also one with a pending task): reconciles the person and their memberships ' +
      'with the identity provider now, as the first call of a session does, so an invitation accepted while ' +
      'signed in shows up at once (the `/accept-invitation` page calls it once). Answers what `GET /api/me` ' +
      'answers. At most once per person every 10 seconds per server process; an API key is refused.',
    security: [{ [BEARER_SCHEME]: [] }],
    middleware: authn(deps, { allowPending: true }),
    responses: {
      200: { description: 'The caller, reconciled', content: { 'application/json': { schema: MeSchema } } },
      401: error('No credential, or one that is not valid (`unauthenticated`)'),
      403: error('An API key (`forbidden`) or a deactivated account (`user_deactivated`)'),
      429: error('Asked again within 10 seconds (`rate_limited`); `Retry-After` says when to try again'),
      503: error(
        'Sign-in is off (`identity_not_configured`) or the provider is away (`identity_unavailable`)',
      ),
    },
  });

const syncRoute = (deps: ServerDeps) => {
  const { base, refusals } = companyRoute(deps, {
    role: 'admin',
    path: '/api/companies/{companyId}/sync',
    tag: 'identity',
  });
  return createRoute({
    ...base,
    method: 'post',
    summary: "Sync now: bring the company's members and invitations in line with the identity provider",
    description:
      'Runs the company reconcile at once (the jobs loop runs it periodically): accepted invitations become active ' +
      'members, people the provider no longer has are removed, and acceptances of revoked or expired invitations ' +
      'are undone at the provider through the outbox.',
    request: { params: SyncParamsSchema },
    responses: {
      200: {
        description: 'What the sync did',
        content: { 'application/json': { schema: CompanySyncSchema } },
      },
      401: refusals[401],
      403: refusals[403],
      404: refusals[404],
      503: error('The identity provider is away (`identity_unavailable`)'),
    },
  });
};

const tooLarge = (c: Context) =>
  errorJson(c as Context<AppEnv>, 413, 'payload_too_large', 'The webhook body is larger than 512 KB');

/** No bearer: the signature over the exact body is the authentication, so the body is read raw, and capped. */
const clerkWebhookRoute = () =>
  createRoute({
    method: 'post',
    path: '/api/webhooks/clerk',
    tags: ['identity'],
    summary: "Clerk's webhook endpoint: verified, recorded once, projected",
    description:
      'Clerk (svix) deliveries of `user.*`, `organization.*`, `organizationMembership.*` and ' +
      '`organizationInvitation.*`. No bearer: the svix signature (`svix-id`, `svix-timestamp`, `svix-signature`) ' +
      'over the exact body is the authentication. A verified delivery is recorded once by its svix id and projected ' +
      'at once; a replay does nothing, and a processing failure is still a 200 (the event is retried here, not by ' +
      'Clerk).',
    middleware: bodyLimit({ maxSize: WEBHOOK_MAX_BYTES, onError: tooLarge }),
    responses: {
      200: jsonResponse(
        'The delivery was verified (and recorded, unless it was a replay)',
        WebhookReceiptSchema,
      ),
      400: error(
        'A missing or bad signature, or a stale or future timestamp (`invalid_signature`); a signed body that is ' +
          'not a valid event (`invalid_payload`). Nothing is recorded.',
      ),
      413: error('A body over 512 KB (`payload_too_large`)'),
      503: error(
        'Webhooks are not configured: no signing secret, or sign-in is off (`webhooks_not_configured`)',
      ),
    },
  });

/**
 * `GET /api/me` (who is calling, with reconcile on sign-in), `POST /api/me/reconcile` (the same reconcile at once, on
 * the person's request), `POST /api/companies/:companyId/sync` and the webhook inbox, `POST /api/webhooks/clerk`.
 * Each of them may start or end memberships, which moves people on the org chart (`chart`, from `createApp`).
 */
export function identityRoutes(deps: ServerDeps & ChartDeps) {
  const me = meService(deps);
  return newRouter()
    .openapi(meRoute(deps), async (c) => {
      const result = await me.me(c.var.actor, c.var.clock, c.var.requestId);
      if (!result.ok && result.status === 401) return errorJson(c, 401, result.code, result.message);
      if (!result.ok) return errorJson(c, 403, result.code, result.message);
      return c.json(result.me, 200);
    })
    .openapi(reconcileMeRoute(deps), async (c) => {
      const result = await me.reconcile(c.var.actor, c.var.clock, c.var.requestId);
      if (result.ok) return c.json(result.me, 200);
      if (result.status === 429) {
        const seconds = Math.ceil(result.retryAfterMs / 1000);
        c.header('retry-after', String(seconds));
        return errorJson(c, 429, result.code, `Reconciled a moment ago; try again in ${seconds} s`);
      }
      if (result.status === 401) return errorJson(c, 401, result.code, result.message);
      return errorJson(c, 403, result.code, result.message);
    })
    .openapi(syncRoute(deps), async (c) =>
      c.json(await reconcileCompany(deps, c.var.tenant.companyId, c.var.requestId), 200),
    )
    .openapi(clerkWebhookRoute(), async (c) => {
      const result = await receiveWebhook(deps, { headers: c.req.header(), rawBody: await c.req.text() });
      if (result.ok) return c.json({ status: result.status }, 200);
      if (result.status === 503) return errorJson(c, 503, result.code, result.message);
      return errorJson(c, 400, result.code, result.message);
    });
}
