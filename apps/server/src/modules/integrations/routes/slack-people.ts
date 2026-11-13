import { createRoute } from '@hono/zod-openapi';
import { type PersonalPath, personalRoute } from '../../../platform/auth/personal.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import {
  SlackPeopleQuerySchema,
  SlackPeopleSchema,
  SlackSignInParamsSchema,
} from '../schemas/slack-inbound.ts';
import type { SlackPeople } from '../service/slack/inbound/people.ts';

/**
 * A Slack bot sign-in's workspace people (2026-11-13, docs/subscriptions.md "Slack: receiving messages"): a search
 * (`GET /api/me/subscriptions/{credentialId}/slack-people?q=`, no words only warming the directory) and a reload of the
 * directory (`POST …/slack-people/refresh`). Personal and session-only, like the sign-ins.
 */

const PEOPLE = '/api/me/subscriptions/{credentialId}/slack-people';

const route = <P extends PersonalPath>(deps: ServerDeps, path: P) =>
  personalRoute(deps, { path, tag: 'subscriptions' });

const searchRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, PEOPLE);
  return createRoute({
    ...base,
    method: 'get',
    summary: "Search a Slack bot sign-in's workspace for people",
    description:
      "Among the workspace's people (`users.list`, every page loaded once in the background and kept for 6 hours): " +
      'names whose words start with the words first, then names holding them, then emails; at most 20, no bots or ' +
      'deactivated people. While they load, the people so far with `loading`. A whole email nobody has is looked up ' +
      'with `users.lookupByEmail`. No words only starts the load. A use of the sign-in (`slack_people`) per load.',
    request: { params: SlackSignInParamsSchema, query: SlackPeopleQuerySchema },
    responses: {
      200: jsonResponse('The people found', SlackPeopleSchema),
      400: errorResponse('The words are too long (`invalid_request`)'),
      ...refusals,
      404: errorResponse(
        "No such Slack sign-in of yours (`credential_not_found`); another person's is the same",
      ),
      422: errorResponse(
        'Slack refused (`slack_refused`: a missing scope, in words), a user token or a revoked sign-in',
      ),
      502: errorResponse('Slack did not answer (`provider_unavailable`)'),
    },
  });
};

const refreshRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, `${PEOPLE}/refresh`);
  return createRoute({
    ...base,
    method: 'post',
    summary: "Load a Slack bot sign-in's workspace people again",
    description:
      'Drops the people kept and loads them again (unless a load is under way); answers as a search with no words.',
    request: { params: SlackSignInParamsSchema },
    responses: {
      200: jsonResponse('The load under way', SlackPeopleSchema),
      ...refusals,
      404: errorResponse(
        "No such Slack sign-in of yours (`credential_not_found`); another person's is the same",
      ),
      422: errorResponse(
        'Slack refused (`slack_refused`: a missing scope, in words), a user token or a revoked sign-in',
      ),
      502: errorResponse('Slack did not answer (`provider_unavailable`)'),
    },
  });
};

/** The routes on the people search. */
export function slackPeopleRoutes(deps: ServerDeps, people: SlackPeople) {
  return newRouter()
    .openapi(searchRoute(deps), async (c) => {
      const { credentialId } = c.req.valid('param');
      const result = await people.search(c.var.userId, credentialId, c.req.valid('query').q ?? '');
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      const { ok: _ok, ...answer } = result;
      return c.json(answer, 200);
    })
    .openapi(refreshRoute(deps), async (c) => {
      const { credentialId } = c.req.valid('param');
      const result = await people.search(c.var.userId, credentialId, '', { refresh: true });
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      const { ok: _ok, ...answer } = result;
      return c.json(answer, 200);
    });
}
