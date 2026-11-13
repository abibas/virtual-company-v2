import { createRoute } from '@hono/zod-openapi';
import { type PersonalPath, personalRoute } from '../../../platform/auth/personal.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import {
  AccessProfileListSchema,
  AccessProfileParamsSchema,
  AccessProfileSchema,
  CreateAccessProfileSchema,
  UpdateAccessProfileSchema,
} from '../schemas/profiles.ts';
import { accessProfilesService } from '../service/profiles.ts';

/**
 * `/api/me/access-profiles` (S3.4; generic since 2026-11-13, docs/subscriptions.md "Profiles"): the caller's own
 * profiles, each a name and optional parts (Claude, OpenAI, GitHub, Atlassian), which they give to agents in companies
 * where they are an admin or owner (the agent routes; an agent needs the part its harness runs on) and choose as their
 * default there, one per AI part. Personal, and managed only signed in to the web app: an API key is refused (403
 * `session_required`).
 */

const PROFILES = '/api/me/access-profiles' as const;
const INVALID = errorResponse('The request does not match the schema (`invalid_request`)');
const NOT_FOUND = errorResponse(
  "No such profile of yours (`access_profile_not_found`); another person's is the same",
);
const NAME_TAKEN = errorResponse('You have a profile of that name already (`access_profile_name_taken`)');
const CREDENTIAL_REFUSED = errorResponse(
  'None of your credentials (`credential_not_found`); a kind the place does not take (`credential_kind_mismatch`: ' +
    'a Claude part takes `claude_oauth`, `claude_setup_token`, `anthropic_api_key`; an OpenAI part `codex_oauth`, ' +
    '`openai_api_key`; a gateway any gateway; GitHub `github_oauth`, `github_token`; Atlassian `atlassian_api_token`); ' +
    'a revoked one (`credential_revoked`); a model of the other provider (`model_provider_mismatch`); an effort its ' +
    'model, or its provider, does not take (`effort_unsupported`: Claude takes low to max, Codex low to ultra, some ' +
    'models fewer); both a Claude and an OpenAI part (`one_ai_part`: a profile runs one AI)',
);
const UPDATE_REFUSED = errorResponse(
  'As for a new profile (a second AI part: `one_ai_part`), or removing an AI part agents run on (`profile_part_in_use`, ' +
    'naming them)',
);

const profilesRoute = <P extends PersonalPath>(deps: ServerDeps, path: P) =>
  personalRoute(deps, { path, tag: 'access-profiles' });

const listRoute = (deps: ServerDeps) => {
  const { base, refusals } = profilesRoute(deps, PROFILES);
  return createRoute({
    ...base,
    method: 'get',
    summary: 'Your profiles, with their parts (credentials as metadata) and the agents using each',
    responses: { 200: jsonResponse('Your profiles, oldest first', AccessProfileListSchema), ...refusals },
  });
};

const createProfileRoute = (deps: ServerDeps) => {
  const { base, refusals } = profilesRoute(deps, PROFILES);
  return createRoute({
    ...base,
    method: 'post',
    summary: 'Make a profile: a name and, optionally, its Claude, OpenAI, GitHub and Atlassian parts',
    request: { body: jsonBody(CreateAccessProfileSchema) },
    responses: {
      201: jsonResponse('The new profile', AccessProfileSchema),
      400: INVALID,
      ...refusals,
      409: NAME_TAKEN,
      422: CREDENTIAL_REFUSED,
    },
  });
};

const updateProfileRoute = (deps: ServerDeps) => {
  const { base, refusals } = profilesRoute(deps, `${PROFILES}/{profileId}`);
  return createRoute({
    ...base,
    method: 'patch',
    summary: 'Rename one of your profiles, or add, change or remove its parts',
    request: { params: AccessProfileParamsSchema, body: jsonBody(UpdateAccessProfileSchema) },
    responses: {
      200: jsonResponse('The profile after the change', AccessProfileSchema),
      400: INVALID,
      ...refusals,
      404: NOT_FOUND,
      409: NAME_TAKEN,
      422: UPDATE_REFUSED,
    },
  });
};

const removeProfileRoute = (deps: ServerDeps) => {
  const { base, refusals } = profilesRoute(deps, `${PROFILES}/{profileId}`);
  return createRoute({
    ...base,
    method: 'delete',
    summary: 'Remove one of your profiles: the agents using it and your defaults lose it',
    request: { params: AccessProfileParamsSchema },
    responses: { 204: { description: 'Removed' }, ...refusals, 404: NOT_FOUND },
  });
};

/** The caller of a personal route: the signed-in person and the request. */
const callerOf = (v: { userId: string; requestId: string }) => ({ userId: v.userId, requestId: v.requestId });

export function accessProfileRoutes(deps: ServerDeps) {
  const profiles = accessProfilesService(deps);
  return newRouter()
    .openapi(listRoute(deps), async (c) => c.json({ profiles: await profiles.list(callerOf(c.var)) }, 200))
    .openapi(createProfileRoute(deps), async (c) => {
      const result = await profiles.create(callerOf(c.var), c.req.valid('json'));
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.profile, 201);
    })
    .openapi(updateProfileRoute(deps), async (c) => {
      const { profileId } = c.req.valid('param');
      const result = await profiles.update(callerOf(c.var), profileId, c.req.valid('json'));
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.profile, 200);
    })
    .openapi(removeProfileRoute(deps), async (c) => {
      const result = await profiles.remove(callerOf(c.var), c.req.valid('param').profileId);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.body(null, 204);
    });
}
