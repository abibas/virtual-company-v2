import { createRoute } from '@hono/zod-openapi';
import type { MembershipRole } from '@mwc/shared/enums';
import { type CompanyPath, companyRoute } from '../../../platform/auth/membership.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { MachineStatsListSchema } from '../schemas/stats.ts';
import {
  MachineListSchema,
  MachineParamsSchema,
  MachineSchema,
  MachinesParamsSchema,
  UpdateMachineSchema,
} from '../schemas.ts';
import { machineStatsList } from '../service/stats.ts';
import type { Caller, MachinesService } from '../service.ts';

/**
 * `/api/companies/{companyId}/machines`: the company's machines and the home board's stats (viewer and above), changing
 * one (its name, a devbox's controller) and removing one (admin and above). Another company's machine is a 404.
 */

const MACHINES = '/api/companies/{companyId}/machines' as const;
const INVALID = errorResponse('The request does not match the schema (`invalid_request`)');
const NO_MACHINE = errorResponse(
  'No such company, or not an active member of it (`not_found`), or no such machine in it (`machine_not_found`)',
);

const route = <P extends CompanyPath>(deps: ServerDeps, role: MembershipRole, path: P) =>
  companyRoute(deps, { role, path, tag: 'machines' });

const listRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'viewer', MACHINES);
  return createRoute({
    ...base,
    method: 'get',
    summary: 'The machines (viewer and above), by name, and the latest runner this server hands out',
    request: { params: MachinesParamsSchema },
    responses: {
      200: jsonResponse(
        'The machines and `latestRunner` (null while the runner is not built)',
        MachineListSchema,
      ),
      401: refusals[401],
      404: refusals[404],
    },
  });
};

const statsRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'viewer', `${MACHINES}/stats`);
  return createRoute({
    ...base,
    method: 'get',
    summary: "The home board's stats of every machine (viewer and above)",
    description:
      'Per machine: the latest sample when under 3 minutes old, when it came online, its runtime over 24 hours and 7 ' +
      'days, a 24-hour load sparkline in 5-minute buckets, its up/down segments and whether it is overloaded.',
    request: { params: MachinesParamsSchema },
    responses: {
      200: jsonResponse('The stats', MachineStatsListSchema),
      401: refusals[401],
      404: refusals[404],
    },
  });
};

const getRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'viewer', `${MACHINES}/{machineId}`);
  return createRoute({
    ...base,
    method: 'get',
    summary: 'A machine (viewer and above)',
    request: { params: MachineParamsSchema },
    responses: { 200: jsonResponse('The machine', MachineSchema), 401: refusals[401], 404: NO_MACHINE },
  });
};

const updateRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'admin', `${MACHINES}/{machineId}`);
  return createRoute({
    ...base,
    method: 'patch',
    summary: "Rename a machine, or choose a devbox's controller (admin and above)",
    description:
      '`controllerMachineId` names the machine of this company whose runner starts and stops this devbox; null ' +
      'clears it (the one connected machine that can power it is then picked when it is next powered).',
    request: { params: MachineParamsSchema, body: jsonBody(UpdateMachineSchema) },
    responses: {
      200: jsonResponse('The machine, changed', MachineSchema),
      400: INVALID,
      ...refusals,
      404: NO_MACHINE,
      422: errorResponse(
        'A controller for a machine that is not a devbox (`not_a_vm`), an unknown one (`controller_not_found`) or ' +
          'itself (`controller_is_self`)',
      ),
    },
  });
};

const removeRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'admin', `${MACHINES}/{machineId}`);
  return createRoute({
    ...base,
    method: 'delete',
    summary: 'Remove a machine (admin and above)',
    description:
      'Its runner keys are revoked and its socket is closed (4001): its runner is refused from then on. It goes from ' +
      'every list; its history stays. Enroll the machine again to bring it back.',
    request: { params: MachineParamsSchema },
    responses: { 204: { description: 'Removed' }, ...refusals, 404: NO_MACHINE },
  });
};

/** Who acts, from the guard's membership, the request id and the clock. */
const callerOf = (v: {
  membership: { principalId: string };
  requestId: string;
  clock: () => Date;
}): Caller => ({
  principalId: v.membership.principalId,
  requestId: v.requestId,
  now: v.clock(),
});

export function machineRoutes(deps: ServerDeps, machines: MachinesService) {
  // `stats` before `{machineId}`, so it is not taken for a machine's id.
  return newRouter()
    .openapi(listRoute(deps), async (c) => {
      const [list, latestRunner] = await Promise.all([machines.list(c.var.tenant), machines.latestRunner()]);
      return c.json({ machines: list, latestRunner }, 200);
    })
    .openapi(statsRoute(deps), async (c) => c.json(await machineStatsList(c.var.tenant, c.var.clock()), 200))
    .openapi(getRoute(deps), async (c) => {
      const result = await machines.get(c.var.tenant, c.req.valid('param').machineId);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.machine, 200);
    })
    .openapi(updateRoute(deps), async (c) => {
      const { machineId } = c.req.valid('param');
      const result = await machines.update(c.var.tenant, callerOf(c.var), machineId, c.req.valid('json'));
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.machine, 200);
    })
    .openapi(removeRoute(deps), async (c) => {
      const result = await machines.remove(c.var.tenant, callerOf(c.var), c.req.valid('param').machineId);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.body(null, 204);
    });
}
