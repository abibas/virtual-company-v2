import { createRoute } from '@hono/zod-openapi';
import { companyRoute } from '../../../platform/auth/membership.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { DefaultProfileBodySchema, DefaultProfileSchema } from '../schemas/profiles.ts';
import { AgentsParamsSchema } from '../schemas.ts';
import { callerOf } from '../service/audit.ts';
import type { OrgService } from '../service.ts';

/**
 * `PUT /api/companies/{companyId}/me/default-profile` (S3.4, one per provider since 2026-11-10): a member's own default
 * access profile of a provider for the agents they hire there, mounted by the org module's routes.
 */

const defaultProfileRoute = (deps: ServerDeps) => {
  const path = '/api/companies/{companyId}/me/default-profile' as const;
  const { base, refusals } = companyRoute(deps, { role: 'viewer', path, tag: 'agents' });
  return createRoute({
    ...base,
    method: 'put',
    summary: 'Your default access profile of one provider for the agents you hire here, or null for none',
    description:
      'One per provider: `claude` for the Claude Code agents you hire, `openai` for the Codex ones. Clearing one is ' +
      'any active member’s; a profile must be yours, of that provider, chosen signed in as an admin or owner.',
    request: { params: AgentsParamsSchema, body: jsonBody(DefaultProfileBodySchema) },
    responses: {
      200: jsonResponse('Your defaults here', DefaultProfileSchema),
      400: errorResponse('The request does not match the schema (`invalid_request`)'),
      401: refusals[401],
      403: errorResponse(
        'Below admin (`forbidden`), an access profile that is not yours to give (`profile_not_yours`), or one given ' +
          'with an API key (`session_required`)',
      ),
      404: refusals[404],
      422: errorResponse(
        'No such access profile (`profile_not_found`), or one of the other provider (`provider_mismatch`)',
      ),
    },
  });
};

export function defaultProfileRoutes(deps: ServerDeps, org: OrgService) {
  return newRouter().openapi(defaultProfileRoute(deps), async (c) => {
    const result = await org.setDefaultProfile(c.var.tenant, callerOf(c.var), c.req.valid('json'));
    if (!result.ok) return errorJson(c, result.status, result.code, result.message);
    return c.json(result.value, 200);
  });
}
