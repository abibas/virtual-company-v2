import { createRoute } from '@hono/zod-openapi';
import { type CompanyPath, companyRoute } from '../../platform/auth/membership.ts';
import type { ServerDeps } from '../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../platform/http/errors.ts';
import { newRouter } from '../../platform/http/router.ts';
import { wantsAll } from './rules.ts';
import {
  ApiKeyListQuerySchema,
  ApiKeyListSchema,
  ApiKeyParamsSchema,
  ApiKeySchema,
  ApiKeysParamsSchema,
  CreateApiKeySchema,
  CreatedApiKeySchema,
} from './schemas.ts';
import { apiKeysService, type Caller } from './service.ts';

/**
 * `/api/companies/{companyId}/api-keys`: personal API keys for the `mwc` CLI and (S2.6) `@mwc/mcp`. Every active
 * member makes and revokes their own keys; admins and owners list and revoke everyone's. A key acts as its owner in
 * this company only, and never makes keys.
 */

const keysRoute = <P extends CompanyPath>(deps: ServerDeps, path: P) =>
  companyRoute(deps, { role: 'viewer', path, tag: 'api-keys' });

const KEYS = '/api/companies/{companyId}/api-keys' as const;
const INVALID = errorResponse('The request does not match the schema (`invalid_request`)');

const createKeyRoute = (deps: ServerDeps) => {
  const { base, refusals } = keysRoute(deps, KEYS);
  return createRoute({
    ...base,
    method: 'post',
    summary: 'Make a personal API key for yourself (signed in to the web app only)',
    description:
      'The response carries the whole key (`secret`) once; only its SHA-256 and its prefix are stored. It expires ' +
      'after `expiresInDays` (90 by default, 1 to 365), acts as you in this company only, and has full access as ' +
      'you (`scopes` empty). An API key cannot make keys.',
    request: { params: ApiKeysParamsSchema, body: jsonBody(CreateApiKeySchema) },
    responses: {
      201: jsonResponse('The new key, with its secret (shown in this response only)', CreatedApiKeySchema),
      400: INVALID,
      401: refusals[401],
      403: errorResponse('Called with an API key, or no longer an active member (`forbidden`)'),
      404: refusals[404],
    },
  });
};

const listKeysRoute = (deps: ServerDeps) => {
  const { base, refusals } = keysRoute(deps, KEYS);
  return createRoute({
    ...base,
    method: 'get',
    summary: "Your personal API keys; with `?all=1` everyone's, with their owners (admin and above)",
    request: { params: ApiKeysParamsSchema, query: ApiKeyListQuerySchema },
    responses: {
      200: jsonResponse('The keys, newest first (never a secret or a hash)', ApiKeyListSchema),
      400: INVALID,
      401: refusals[401],
      403: errorResponse('`?all=1` below admin (`forbidden`)'),
      404: refusals[404],
    },
  });
};

const revokeKeyRoute = (deps: ServerDeps) => {
  const { base, refusals } = keysRoute(deps, `${KEYS}/{keyId}`);
  return createRoute({
    ...base,
    method: 'delete',
    summary: "Revoke a personal API key: your own, or anyone's as an admin or owner",
    description: 'The key is refused (401) from now on. A key revoked already is answered as it is.',
    request: { params: ApiKeyParamsSchema },
    responses: {
      200: jsonResponse('The key, revoked', ApiKeySchema),
      401: refusals[401],
      403: errorResponse("A member or viewer revoking someone else's key (`forbidden`)"),
      404: errorResponse(
        'No such company, a deleted one, or one the caller is not an active member of (`not_found`), or no such ' +
          'key in it (`api_key_not_found`)',
      ),
    },
  });
};

/** Who acts, from the guard's membership, the request id and the clock. */
const callerOf = (
  v: { membership: Pick<Caller, 'principalId' | 'role'> & { id: string }; requestId: string },
  now: Date,
): Caller => ({
  membershipId: v.membership.id,
  principalId: v.membership.principalId,
  role: v.membership.role,
  requestId: v.requestId,
  now,
});

export function apiKeysRoutes(deps: ServerDeps) {
  const keys = apiKeysService(deps);
  return newRouter()
    .openapi(createKeyRoute(deps), async (c) => {
      const { name, expiresInDays } = c.req.valid('json');
      const call = { ...callerOf(c.var, c.var.clock()), via: c.var.actor.via, name, expiresInDays };
      const result = await keys.create(c.var.tenant, call);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      // The secret is in this response only: no cache may keep it.
      c.header('cache-control', 'no-store');
      return c.json(result.key, 201);
    })
    .openapi(listKeysRoute(deps), async (c) => {
      const all = wantsAll(c.req.valid('query').all);
      const result = await keys.list(c.var.tenant, { ...callerOf(c.var, c.var.clock()), all });
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json({ apiKeys: result.keys }, 200);
    })
    .openapi(revokeKeyRoute(deps), async (c) => {
      const { keyId } = c.req.valid('param');
      const result = await keys.revoke(c.var.tenant, { ...callerOf(c.var, c.var.clock()), keyId });
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.key, 200);
    });
}
