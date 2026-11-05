import { createRoute } from '@hono/zod-openapi';
import { type PersonalPath, personalRoute } from '../../platform/auth/personal.ts';
import type { ServerDeps } from '../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../platform/http/errors.ts';
import { newRouter } from '../../platform/http/router.ts';
import type { Keyring } from '../../platform/secrets/keyring.ts';
import { accessProfileRoutes } from './routes/profiles.ts';
import { wantsRefresh } from './rules/limits.ts';
import { LimitsQuerySchema, SubscriptionLimitsListSchema } from './schemas/limits.ts';
import {
  AddSubscriptionSchema,
  RenameSubscriptionSchema,
  SubscriptionListSchema,
  SubscriptionParamsSchema,
  SubscriptionSchema,
} from './schemas.ts';
import { limitsService } from './service/limits.ts';
import { memoryUsageCache, type UsageCache } from './service/usage/cache.ts';
import { providerFetchFor } from './service/usage/http.ts';
import { credentialsService } from './service.ts';

/**
 * `/api/me/subscriptions`: the caller's own subscriptions, API keys and gateways (docs/subscriptions.md). Write-only:
 * a secret goes in once and never comes back out, not even to its owner. Personal, never a company's, and managed
 * only signed in to the web app: an API key is refused (403 `session_required`).
 */

const SUBSCRIPTIONS = '/api/me/subscriptions' as const;
const INVALID = errorResponse('The request does not match the schema (`invalid_request`)');
const NOT_FOUND = errorResponse(
  "No such subscription of yours (`credential_not_found`); another person's is the same",
);

const subscriptionsRoute = <P extends PersonalPath>(deps: ServerDeps, path: P) =>
  personalRoute(deps, { path, tag: 'subscriptions' });

const listRoute = (deps: ServerDeps) => {
  const { base, refusals } = subscriptionsRoute(deps, SUBSCRIPTIONS);
  return createRoute({
    ...base,
    method: 'get',
    summary: 'Your subscriptions, as metadata: never a secret',
    responses: { 200: jsonResponse('Your subscriptions, oldest first', SubscriptionListSchema), ...refusals },
  });
};

const addRoute = (deps: ServerDeps) => {
  const { base, refusals } = subscriptionsRoute(deps, SUBSCRIPTIONS);
  return createRoute({
    ...base,
    method: 'post',
    summary: 'Add a pasted subscription: a setup-token, an Anthropic or OpenAI API key, or a gateway',
    description:
      'The secret is checked for its format only (a setup-token starts with `sk-ant-oat01-`, an Anthropic key with ' +
      '`sk-ant-api`, an OpenAI key with `sk-`; a gateway has an http(s) address and 1 to 20 headers), sealed with ' +
      'AES-256-GCM and never shown again. No provider is called. The two logins are added by signing in.',
    request: { body: jsonBody(AddSubscriptionSchema) },
    responses: {
      201: jsonResponse('The subscription, without its secret', SubscriptionSchema),
      400: INVALID,
      ...refusals,
    },
  });
};

const renameRoute = (deps: ServerDeps) => {
  const { base, refusals } = subscriptionsRoute(deps, `${SUBSCRIPTIONS}/{credentialId}`);
  return createRoute({
    ...base,
    method: 'patch',
    summary: 'Rename one of your subscriptions',
    request: { params: SubscriptionParamsSchema, body: jsonBody(RenameSubscriptionSchema) },
    responses: {
      200: jsonResponse('The subscription, renamed', SubscriptionSchema),
      400: INVALID,
      ...refusals,
      404: NOT_FOUND,
    },
  });
};

const removeRoute = (deps: ServerDeps) => {
  const { base, refusals } = subscriptionsRoute(deps, `${SUBSCRIPTIONS}/{credentialId}`);
  return createRoute({
    ...base,
    method: 'delete',
    summary: 'Remove one of your subscriptions and its secret',
    description: 'Its audit rows and the record of its uses stay.',
    request: { params: SubscriptionParamsSchema },
    responses: { 204: { description: 'Removed' }, ...refusals, 404: NOT_FOUND },
  });
};

const limitsRoute = (deps: ServerDeps) => {
  const { base, refusals } = subscriptionsRoute(deps, `${SUBSCRIPTIONS}/limits`);
  return createRoute({
    ...base,
    method: 'get',
    summary: "Your subscriptions' live 5-hour and weekly limits",
    description:
      'For each of your subscriptions, its windows from the provider: a Claude login from `GET ' +
      'api.anthropic.com/api/oauth/usage`, an OpenAI login from `GET chatgpt.com/backend-api/wham/usage` (both ' +
      'refreshing an expired token and storing it sealed again), a setup-token from the ' +
      '`anthropic-ratelimit-unified-*` headers of a one-token Messages request; API keys and gateways have none ' +
      "(`source: 'none'`). Answers come from the server's cache: a subscription never checked yet is checked now, " +
      'and `refresh=1` also checks one whose last check is at least 5 minutes old (15 for the setup-token probe, ' +
      'which spends a little of the subscription). A failed check keeps the last good windows, marked `stale`, ' +
      'with the refusal in plain words. A login that no longer signs in is marked `needs_sign_in`.',
    request: { query: LimitsQuerySchema },
    responses: {
      200: jsonResponse('Your subscriptions with their limits, oldest first', SubscriptionLimitsListSchema),
      400: INVALID,
      ...refusals,
    },
  });
};

/** The caller of a personal route: the signed-in person and the request. */
const callerOf = (v: { userId: string; requestId: string }) => ({ userId: v.userId, requestId: v.requestId });

/**
 * The router: the store's deps, plus the provider client of the usage checks (`AppDeps.providerFetch`, else the
 * platform's `fetch`, refused under NODE_ENV=test) and their cache (this process's memory unless one is passed).
 */
export function credentialsRoutes(
  deps: ServerDeps & { readonly keyring: Keyring; readonly usageCache?: UsageCache },
) {
  const subscriptions = credentialsService(deps);
  const limits = limitsService({
    ...deps,
    providerFetch: deps.providerFetch ?? providerFetchFor(deps.config),
    usageCache: deps.usageCache ?? memoryUsageCache(),
  });
  return newRouter()
    .openapi(listRoute(deps), async (c) =>
      c.json({ subscriptions: await subscriptions.list(callerOf(c.var)) }, 200),
    )
    .openapi(limitsRoute(deps), async (c) => {
      const refresh = wantsRefresh(c.req.valid('query').refresh);
      return c.json({ limits: await limits.list(callerOf(c.var), refresh) }, 200);
    })
    .openapi(addRoute(deps), async (c) =>
      c.json(await subscriptions.add(callerOf(c.var), c.req.valid('json')), 201),
    )
    .openapi(renameRoute(deps), async (c) => {
      const { credentialId } = c.req.valid('param');
      const result = await subscriptions.rename(callerOf(c.var), credentialId, c.req.valid('json').label);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.subscription, 200);
    })
    .openapi(removeRoute(deps), async (c) => {
      const result = await subscriptions.remove(callerOf(c.var), c.req.valid('param').credentialId);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.body(null, 204);
    })
    .route('/', accessProfileRoutes(deps));
}
