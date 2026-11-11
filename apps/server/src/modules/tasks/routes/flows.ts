import { createRoute } from '@hono/zod-openapi';
import type { MembershipRole } from '@mwc/shared/enums';
import { type CompanyPath, companyRoute } from '../../../platform/auth/membership.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import {
  CreateFlowSchema,
  FlowListSchema,
  FlowSchema,
  PutStepsSchema,
  RenameFlowSchema,
} from '../schemas/flows.ts';
import { CompanyParamsSchema, FlowParamsSchema, LeadParamsSchema } from '../schemas.ts';
import { callerOf, type TasksService } from '../service.ts';

/**
 * A team's flow (S5.3a): `GET|POST /api/companies/{companyId}/flows`, `GET|PATCH …/flows/{flowId}`,
 * `PUT …/flows/{flowId}/steps` and `GET …/leads/{lead}/flow`. Everyone of the company reads; the team's Lead people
 * (the Lead when a person, every person above it) and admins and owners make, rename and change a flow.
 */

const FLOWS = '/api/companies/{companyId}/flows' as const;
const FLOW = '/api/companies/{companyId}/flows/{flowId}' as const;

export const INVALID = errorResponse('The request does not match the schema (`invalid_request`)');
export const NO_FLOW = errorResponse(
  'No such company or not an active member (`not_found`), or no such flow (`flow_not_found`)',
);
const NOT_LEAD = errorResponse(
  "Below member (`forbidden`), or not one of the team's Lead people nor an admin or owner (`not_lead`)",
);
const BAD_STEPS = errorResponse(
  'The step list is refused: `no_steps`, `too_many_steps`, `duplicate_step_name`, `unknown_step`, ' +
    '`assignee_not_found`, `work_sends_back`, `bad_send_back`',
);

export const route = <P extends CompanyPath>(deps: ServerDeps, role: MembershipRole, path: P) =>
  companyRoute(deps, { role, path, tag: 'flows' });

const listRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'viewer', FLOWS);
  return createRoute({
    ...base,
    method: 'get',
    summary: "The company's flows (viewer and above), oldest first, with their Lead, steps and open tasks",
    request: { params: CompanyParamsSchema },
    responses: { 200: jsonResponse('The flows', FlowListSchema), 401: refusals[401], 404: refusals[404] },
  });
};

const createFlowRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'member', FLOWS);
  return createRoute({
    ...base,
    method: 'post',
    summary: "Make a team's flow with its steps (the Lead's people, admins and owners); one per Lead",
    request: { params: CompanyParamsSchema, body: jsonBody(CreateFlowSchema) },
    responses: {
      201: jsonResponse('The flow', FlowSchema),
      400: INVALID,
      ...refusals,
      403: NOT_LEAD,
      409: errorResponse('The Lead has a flow already (`flow_exists`)'),
      422: errorResponse(
        `The Lead is not an active person or agent on the chart (\`lead_not_found\`), or ${BAD_STEPS.description}`,
      ),
    },
  });
};

const getFlowRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'viewer', FLOW);
  return createRoute({
    ...base,
    method: 'get',
    summary: 'A flow with its steps in order (viewer and above)',
    request: { params: FlowParamsSchema },
    responses: { 200: jsonResponse('The flow', FlowSchema), 401: refusals[401], 404: NO_FLOW },
  });
};

const byLeadRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'viewer', '/api/companies/{companyId}/leads/{lead}/flow');
  return createRoute({
    ...base,
    method: 'get',
    summary: "A Lead's flow (viewer and above): the Lead by principal id, or an agent Lead by its slug",
    request: { params: LeadParamsSchema },
    responses: { 200: jsonResponse('The flow', FlowSchema), 401: refusals[401], 404: NO_FLOW },
  });
};

const renameRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'member', FLOW);
  return createRoute({
    ...base,
    method: 'patch',
    summary: 'Rename a flow (its Lead people, admins and owners)',
    request: { params: FlowParamsSchema, body: jsonBody(RenameFlowSchema) },
    responses: {
      200: jsonResponse('The flow', FlowSchema),
      400: INVALID,
      401: refusals[401],
      403: NOT_LEAD,
      404: NO_FLOW,
    },
  });
};

const putStepsRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'member', `${FLOW}/steps`);
  return createRoute({
    ...base,
    method: 'put',
    summary: "Replace a flow's step list (its Lead people, admins and owners)",
    description:
      'The whole list, in order. An item with `id` is that step (it keeps its id and its tasks, wherever it moves); ' +
      'one without is a new step; a step left out is removed, refused while a task is at it or a retry would send ' +
      'one there (`step_has_tasks`: route them first). `sendsBackTo` names an earlier step of the list.',
    request: { params: FlowParamsSchema, body: jsonBody(PutStepsSchema) },
    responses: {
      200: jsonResponse('The flow', FlowSchema),
      400: INVALID,
      401: refusals[401],
      403: NOT_LEAD,
      404: NO_FLOW,
      409: errorResponse('A step left out has open tasks (`step_has_tasks`)'),
      422: BAD_STEPS,
    },
  });
};

export function flowRoutes(deps: ServerDeps, tasks: TasksService) {
  return newRouter()
    .openapi(listRoute(deps), async (c) => c.json({ flows: await tasks.listFlows(c.var.tenant) }, 200))
    .openapi(createFlowRoute(deps), async (c) => {
      const result = await tasks.createFlow(c.var.tenant, callerOf(c.var), c.req.valid('json'));
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.flow, 201);
    })
    .openapi(getFlowRoute(deps), async (c) => {
      const result = await tasks.flow(c.var.tenant, { id: c.req.valid('param').flowId });
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.flow, 200);
    })
    .openapi(byLeadRoute(deps), async (c) => {
      const result = await tasks.flow(c.var.tenant, { lead: c.req.valid('param').lead });
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.flow, 200);
    })
    .openapi(renameRoute(deps), async (c) => {
      const { flowId } = c.req.valid('param');
      const result = await tasks.renameFlow(c.var.tenant, callerOf(c.var), flowId, c.req.valid('json').name);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.flow, 200);
    })
    .openapi(putStepsRoute(deps), async (c) => {
      const { flowId } = c.req.valid('param');
      const result = await tasks.putSteps(c.var.tenant, callerOf(c.var), flowId, c.req.valid('json').steps);
      if (!result.ok)
        return errorJson(c, result.status as 403 | 404 | 409 | 422, result.code, result.message);
      return c.json(result.flow, 200);
    });
}
