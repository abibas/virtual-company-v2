import { createRoute } from '@hono/zod-openapi';
import type { MembershipRole } from '@mwc/shared/enums';
import { type CompanyPath, companyRoute } from '../../platform/auth/membership.ts';
import type { ServerDeps } from '../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../platform/http/errors.ts';
import { newRouter } from '../../platform/http/router.ts';
import { agentBriefingRoutes } from './routes/briefing.ts';
import { defaultProfileRoutes } from './routes/defaults.ts';
import { agentIconRoutes } from './routes/icons.ts';
import {
  AgentDetailSchema,
  AgentListQuerySchema,
  AgentListSchema,
  AgentParamsSchema,
  AgentsParamsSchema,
  AgentUpdatedSchema,
  CreateAgentSchema,
  OrgChartSchema,
  PositionParamsSchema,
  PositionSchema,
  UpdateAgentSchema,
  UpdatePositionSchema,
} from './schemas.ts';
import { callerOf } from './service/audit.ts';
import { type OrgService, orgService } from './service.ts';

/**
 * `/api/companies/{companyId}/agents` (list and read: viewer and above; create and change: admin and above; an agent's
 * icon: `routes/icons.ts`; its briefing: `routes/briefing.ts`),
 * `/api/companies/{companyId}/org` (a position: admins move anyone and title anyone, members title themselves; the
 * chart: viewer and above) and `/api/companies/{companyId}/me/default-profile` (a member's own default access profile,
 * S3.4). The org rules' refusals are 422s with their codes.
 */

const AGENTS = '/api/companies/{companyId}/agents' as const;
const ORG = '/api/companies/{companyId}/org' as const;
const INVALID = errorResponse('The request does not match the schema (`invalid_request`)');
const REFUSED = errorResponse(
  'The org rules refuse the place: `unknown_principal`, `self`, `cycle`, `agent_root`, `agent_manages_person` ' +
    'or `chain_without_person`, with a sentence to show',
);
const NO_AGENT = errorResponse(
  'No such company, or not an active member of it (`not_found`), or no such agent in it (`agent_not_found`)',
);
const SLUG_TAKEN = errorResponse('Another agent of the company has the slug (`agent_slug_taken`)');
const GIVE_REFUSED = errorResponse(
  'Below admin (`forbidden`), an access profile that is not yours to give (`profile_not_yours`), or one given with an ' +
    'API key (`session_required`)',
);
const REFUSED_OR_NO_PROFILE = errorResponse(
  'The org rules refuse the place (their code and sentence), no such access profile (`profile_not_found`), or one ' +
    'of another provider than the harness runs on (`profile_harness_mismatch`: Claude Code takes a Claude profile, ' +
    'Codex an OpenAI one)',
);

const route = <P extends CompanyPath>(deps: ServerDeps, role: MembershipRole, path: P, tag: string) =>
  companyRoute(deps, { role, path, tag });

const listAgentsRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'viewer', AGENTS, 'agents');
  return createRoute({
    ...base,
    method: 'get',
    summary: 'The agents (viewer and above): active and paused, or `?status=archived`, `?status=all`',
    request: { params: AgentsParamsSchema, query: AgentListQuerySchema },
    responses: {
      200: jsonResponse('The agents, oldest first, without their instructions', AgentListSchema),
      400: INVALID,
      401: refusals[401],
      404: refusals[404],
    },
  });
};

const getAgentRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'viewer', `${AGENTS}/{agentId}`, 'agents');
  return createRoute({
    ...base,
    method: 'get',
    summary: 'An agent with its instructions (viewer and above), archived ones too',
    request: { params: AgentParamsSchema },
    responses: { 200: jsonResponse('The agent', AgentDetailSchema), 401: refusals[401], 404: NO_AGENT },
  });
};

const createAgentRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'admin', AGENTS, 'agents');
  return createRoute({
    ...base,
    method: 'post',
    summary: 'Create an agent on the chart (admin and above)',
    description:
      'Defaults: model `claude-opus-5-5`, effort `high`, harness `claude_code`, one run at a time, the slug from the ' +
      'name (`-2`, `-3`, ... when taken), the face from the slug, the caller as its manager, and the caller’s default ' +
      'access profile here (`profileId`: one of yours, signed in, or null for none).',
    request: { params: AgentsParamsSchema, body: jsonBody(CreateAgentSchema) },
    responses: {
      201: jsonResponse('The new agent', AgentDetailSchema),
      400: INVALID,
      ...refusals,
      403: GIVE_REFUSED,
      409: SLUG_TAKEN,
      422: REFUSED_OR_NO_PROFILE,
    },
  });
};

const updateAgentRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'admin', `${AGENTS}/{agentId}`, 'agents');
  return createRoute({
    ...base,
    method: 'patch',
    summary: 'Change an agent (admin and above); `status: archived` takes it off the chart',
    description:
      'New instructions bump `instructionsRev`. Archiving moves its reports up (to the company’s earliest active ' +
      'owner when nobody above can take an agent) and removes its place; back from the archive it reports to the ' +
      'caller. There is no hard delete. `profileId`: only its owner gives an access profile, signed in, of the ' +
      'provider the harness runs on; any admin takes it off (`null`). A new `harness` its profile does not fit takes ' +
      'the profile off, said in `profileCleared`.',
    request: { params: AgentParamsSchema, body: jsonBody(UpdateAgentSchema) },
    responses: {
      200: jsonResponse('The agent after the change', AgentUpdatedSchema),
      400: INVALID,
      401: refusals[401],
      403: GIVE_REFUSED,
      404: NO_AGENT,
      409: SLUG_TAKEN,
      422: REFUSED_OR_NO_PROFILE,
    },
  });
};

const setPositionRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'viewer', `${ORG}/positions/{principalId}`, 'org');
  return createRoute({
    ...base,
    method: 'put',
    summary:
      'Move a person or an agent (admin and above), or set a title (admins anyone’s, members their own)',
    request: { params: PositionParamsSchema, body: jsonBody(UpdatePositionSchema) },
    responses: {
      200: jsonResponse('The place after the change', PositionSchema),
      400: INVALID,
      401: refusals[401],
      403: errorResponse('Moving anyone, or titling someone else, below admin (`forbidden`)'),
      404: errorResponse(
        'No such company, or not an active member of it (`not_found`), or nobody on its chart by that id: another ' +
          'company’s, a member no longer active, an archived agent (`position_not_found`)',
      ),
      422: REFUSED,
    },
  });
};

const chartRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'viewer', `${ORG}/chart`, 'org');
  return createRoute({
    ...base,
    method: 'get',
    summary: 'The org chart (viewer and above): its people and agents, and the same as a tree',
    request: { params: AgentsParamsSchema },
    responses: { 200: jsonResponse('The chart', OrgChartSchema), 401: refusals[401], 404: refusals[404] },
  });
};

function agentRoutes(deps: ServerDeps, org: OrgService) {
  return newRouter()
    .openapi(listAgentsRoute(deps), async (c) =>
      c.json({ agents: await org.list(c.var.tenant, c.req.valid('query').status) }, 200),
    )
    .openapi(getAgentRoute(deps), async (c) => {
      const result = await org.get(c.var.tenant, c.req.valid('param').agentId);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.agent, 200);
    })
    .openapi(createAgentRoute(deps), async (c) => {
      const result = await org.create(c.var.tenant, callerOf(c.var), c.req.valid('json'));
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.agent, 201);
    })
    .openapi(updateAgentRoute(deps), async (c) => {
      const { agentId } = c.req.valid('param');
      const result = await org.update(c.var.tenant, callerOf(c.var), agentId, c.req.valid('json'));
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      const { profileCleared } = result;
      return c.json(profileCleared ? { ...result.agent, profileCleared } : result.agent, 200);
    })
    .route('/', agentIconRoutes(deps))
    .route('/', agentBriefingRoutes(deps, org));
}

function chartRoutes(deps: ServerDeps, org: OrgService) {
  return newRouter()
    .openapi(setPositionRoute(deps), async (c) => {
      const { principalId } = c.req.valid('param');
      const result = await org.setPosition(c.var.tenant, callerOf(c.var), principalId, c.req.valid('json'));
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.position, 200);
    })
    .openapi(chartRoute(deps), async (c) => c.json(await org.chart(c.var.tenant), 200))
    .route('/', defaultProfileRoutes(deps, org));
}

/** The org module's routes: the agents, and the chart with its positions. */
export function orgRoutes(deps: ServerDeps) {
  const org = orgService(deps);
  return agentRoutes(deps, org).route('/', chartRoutes(deps, org));
}
