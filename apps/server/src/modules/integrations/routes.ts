import { createRoute } from '@hono/zod-openapi';
import type { SlackApi } from '@mwc/tools-core';
import { type PersonalPath, personalRoute } from '../../platform/auth/personal.ts';
import type { ServerDeps } from '../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../platform/http/errors.ts';
import { newRouter } from '../../platform/http/router.ts';
import type { Keyring } from '../../platform/secrets/keyring.ts';
import { credentialsForTools } from '../credentials/index.ts';
import {
  SlackInboundChangeSchema,
  SlackInboundSchema,
  SlackPeopleQuerySchema,
  SlackPeopleSchema,
  SlackSignInParamsSchema,
} from './schemas/slack-inbound.ts';
import { searchPeople } from './service/slack/inbound/people.ts';
import { type SettingsDeps, slackInboundSettings } from './service/slack/inbound/settings.ts';

/**
 * The integrations module's routes (2026-11-13, docs/subscriptions.md "Slack: receiving messages"): a Slack bot
 * sign-in's inbound settings (`GET` and `PUT /api/me/subscriptions/{credentialId}/slack-inbound`: receiving, the app
 * token, who may wake agents, the default agent, the hourly cap, the connection's status) and a search of its
 * workspace's people (`GET …/slack-people?q=`). Personal and session-only, like the sign-ins: an API key is 403
 * `session_required`, another person's sign-in the same 404 as none.
 */

export interface IntegrationsRouteDeps extends ServerDeps {
  readonly keyring: Keyring;
  readonly slack: SlackApi;
  readonly receiving?: SettingsDeps['receiving'];
}

const NOT_FOUND = errorResponse(
  "No such Slack sign-in of yours (`credential_not_found`); another person's is the same",
);

const route = <P extends PersonalPath>(deps: ServerDeps, path: P) =>
  personalRoute(deps, { path, tag: 'subscriptions' });

const INBOUND = '/api/me/subscriptions/{credentialId}/slack-inbound';

const viewRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, INBOUND);
  return createRoute({
    ...base,
    method: 'get',
    summary: "A Slack bot sign-in's inbound settings: receiving messages through Socket Mode",
    description:
      'Whether an app-level token is set (never the token), receiving on or off, who may wake agents (anyone in the ' +
      "channels an agent's profile reaches, or the people listed), the default agent and its choices (the agents whose " +
      "profile's Slack part uses this sign-in), the hourly cap and the last hour's turns, and the connection's status. " +
      "Before they are saved: only listed people, the caller's own Slack person first when a user token of theirs names it.",
    request: { params: SlackSignInParamsSchema },
    responses: {
      200: jsonResponse('The settings', SlackInboundSchema),
      ...refusals,
      404: NOT_FOUND,
      422: errorResponse('A user token (`not_a_slack_bot`) or a revoked sign-in (`credential_revoked`)'),
    },
  });
};

const changeRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, INBOUND);
  return createRoute({
    ...base,
    method: 'put',
    summary: "Change a Slack bot sign-in's inbound settings",
    description:
      'Any of the fields; the app-level token (`xapp-`) is sealed and never shown again, and null removes it (which ' +
      'stops receiving). Audited without the token. The server opens, reopens or closes the connection at once.',
    request: { params: SlackSignInParamsSchema, body: jsonBody(SlackInboundChangeSchema) },
    responses: {
      200: jsonResponse('The settings, as saved', SlackInboundSchema),
      400: errorResponse('The request does not match the schema (`invalid_request`)'),
      ...refusals,
      404: NOT_FOUND,
      422: errorResponse(
        'Receiving without an app token (`app_token_missing`), a default agent that is not one of the choices ' +
          '(`agent_not_eligible`), a user token (`not_a_slack_bot`) or a revoked sign-in (`credential_revoked`)',
      ),
    },
  });
};

const peopleRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, '/api/me/subscriptions/{credentialId}/slack-people');
  return createRoute({
    ...base,
    method: 'get',
    summary: "Search a Slack bot sign-in's workspace for people",
    description:
      "An email with `users.lookupByEmail`, else a name among the workspace's people (`users.list`), at most 20; no " +
      'bots or deactivated people. Recorded as a use of the sign-in (`slack_people`).',
    request: { params: SlackSignInParamsSchema, query: SlackPeopleQuerySchema },
    responses: {
      200: jsonResponse('The people found', SlackPeopleSchema),
      400: errorResponse('No words to look for (`invalid_request`)'),
      ...refusals,
      404: NOT_FOUND,
      422: errorResponse('Slack refused (`slack_refused`: a missing scope, in words), or a user token'),
      502: errorResponse('Slack did not answer (`provider_unavailable`)'),
    },
  });
};

/** The routes on these deps. */
export function integrationsRoutes(deps: IntegrationsRouteDeps) {
  const inbound = { ...deps, credentials: credentialsForTools(deps) };
  const settings = slackInboundSettings(inbound);
  return newRouter()
    .openapi(viewRoute(deps), async (c) => {
      const result = await settings.view(c.var.userId, c.req.valid('param').credentialId);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.view, 200);
    })
    .openapi(changeRoute(deps), async (c) => {
      const caller = { userId: c.var.userId, requestId: c.var.requestId };
      const result = await settings.change(caller, c.req.valid('param').credentialId, c.req.valid('json'));
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.view, 200);
    })
    .openapi(peopleRoute(deps), async (c) => {
      const { credentialId } = c.req.valid('param');
      const result = await searchPeople(inbound, c.var.userId, credentialId, c.req.valid('query').q);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json({ people: result.people }, 200);
    });
}
