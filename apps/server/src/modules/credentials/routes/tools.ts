import { createRoute } from '@hono/zod-openapi';
import { type PersonalPath, personalRoute } from '../../../platform/auth/personal.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import type { Keyring } from '../../../platform/secrets/keyring.ts';
import { AddToolSchema } from '../schemas/tools.ts';
import { SubscriptionParamsSchema, SubscriptionSchema } from '../schemas.ts';
import { toolsService } from '../service/tools.ts';
import { providerFetchFor } from '../service/usage/http.ts';

/**
 * The tool sign-ins (S7.1a, docs/subscriptions.md "Tool sign-ins"): `POST /api/me/subscriptions/tools` adds a pasted
 * GitHub token, an Atlassian site and API token or a Slack token (S7.1e) once its provider accepts it, and `POST
 * /api/me/subscriptions/:credentialId/check` is Check again. They are listed, renamed and removed with the
 * subscriptions; Sign in with GitHub is the sign-in API's. Personal and session-only: an API key is 403
 * `session_required`.
 */

const NOT_FOUND = errorResponse(
  "No such sign-in of yours (`credential_not_found`); another person's is the same",
);

const toolsRoute = <P extends PersonalPath>(deps: ServerDeps, path: P) =>
  personalRoute(deps, { path, tag: 'subscriptions' });

const addRoute = (deps: ServerDeps) => {
  const { base, refusals } = toolsRoute(deps, '/api/me/subscriptions/tools');
  return createRoute({
    ...base,
    method: 'post',
    summary: 'Add a GitHub token, an Atlassian sign-in or a Slack token, checked with its provider first',
    description:
      'A GitHub token (classic `ghp_` or fine-grained `github_pat_`) is checked with `GET api.github.com/user`; an ' +
      'Atlassian site (`<name>.atlassian.net`), account email and API token with Jira `GET /rest/api/3/myself` and ' +
      'Confluence `GET /wiki/rest/api/user/current`, both with basic auth; a Slack token (`kind: slack`: `xoxb-` a ' +
      "bot's, stored as `slack_bot_token`, `xoxp-` a user's, `slack_user_token`) with `auth.test`, keeping its " +
      'workspace, who it is and its scopes. Once the provider names the account, the ' +
      'secret is sealed and never shown again, and that check is recorded as a use. With `credentialId` the new ' +
      "secret replaces that sign-in's in place.",
    request: { body: jsonBody(AddToolSchema) },
    responses: {
      201: jsonResponse('The sign-in, without its secret', SubscriptionSchema),
      400: errorResponse('The request does not match the schema (`invalid_request`)'),
      ...refusals,
      404: NOT_FOUND,
      422: errorResponse(
        'The provider did not accept it, or no Atlassian product answered on the site (`tool_sign_in_refused`); ' +
          '`credentialId` of another kind (`tool_kind_mismatch`) or revoked (`credential_revoked`)',
      ),
      502: errorResponse(
        'The provider did not answer (`provider_unavailable`), rate limited the check (`rate_limited`) or answered ' +
          'something unexpected (`invalid_response`); nothing was stored',
      ),
    },
  });
};

const checkRoute = (deps: ServerDeps) => {
  const { base, refusals } = toolsRoute(deps, '/api/me/subscriptions/{credentialId}/check');
  return createRoute({
    ...base,
    method: 'post',
    summary: 'Check again: ask GitHub, Atlassian or Slack now who one of your tool sign-ins acts as',
    description:
      'A working check sets it `active` with the account the provider names; a 401 sets it `needs_sign_in`; a check ' +
      'that does not finish keeps its status and says why in `checkError`. Each check is recorded as a use. The ' +
      'server also checks every tool sign-in once a day.',
    request: { params: SubscriptionParamsSchema },
    responses: {
      200: jsonResponse('The sign-in, after its check', SubscriptionSchema),
      ...refusals,
      404: NOT_FOUND,
      422: errorResponse('An AI subscription (`not_a_tool`), or a revoked sign-in (`credential_revoked`)'),
    },
  });
};

/** The caller of a personal route: the signed-in person and the request. */
const callerOf = (v: { userId: string; requestId: string }) => ({ userId: v.userId, requestId: v.requestId });

/** The routes, on the store's deps and the provider client (`AppDeps.providerFetch`, refused under NODE_ENV=test). */
export function toolRoutes(deps: ServerDeps & { readonly keyring: Keyring }) {
  const tools = toolsService({ ...deps, providerFetch: deps.providerFetch ?? providerFetchFor(deps.config) });
  return newRouter()
    .openapi(addRoute(deps), async (c) => {
      const result = await tools.add(callerOf(c.var), c.req.valid('json'));
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.signIn, 201);
    })
    .openapi(checkRoute(deps), async (c) => {
      const result = await tools.check(callerOf(c.var), c.req.valid('param').credentialId);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.signIn, 200);
    });
}
