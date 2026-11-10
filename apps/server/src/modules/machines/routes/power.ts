import { createRoute } from '@hono/zod-openapi';
import type { MembershipRole } from '@mwc/shared/enums';
import { MachinePowerPolicy } from '@mwc/shared/machines';
import type { Context } from 'hono';
import type { MemberContext, MemberEnv } from '../../../platform/auth/actor.ts';
import { type CompanyPath, companyRoute } from '../../../platform/auth/membership.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import type { ByHand } from '../rules/container/power.ts';
import type { Refusal } from '../rules.ts';
import {
  MachinePowerSchema,
  PowerActionBodySchema,
  PowerEventsQuerySchema,
  PowerEventsSchema,
  PowerFailedSchema,
  PowerRefusalSchema,
  PowerTimezoneSchema,
} from '../schemas/power.ts';
import { MachineParamsSchema } from '../schemas.ts';
import type { PowerFailure } from '../service/power/controller.ts';
import type { PowerCaller, PowerService } from '../service/power.ts';

/**
 * A machine's power (docs/machines.md, S4.4b): its policy, the scheduler's state, its box and controller or its
 * container (viewer and above), the policy's change, Start and Stop of a devbox or a container runner's container and
 * the box's time zone (admin and above), and its power log. Another company's machine is a 404.
 */

const MACHINE = '/api/companies/{companyId}/machines/{machineId}' as const;
const NO_MACHINE = errorResponse(
  'No such company, or not an active member of it (`not_found`), or no such machine in it (`machine_not_found`)',
);
const INVALID = errorResponse('The request does not match the schema (`invalid_request`)');
const CONTROL_REFUSALS = {
  409: errorResponse(
    'No connected machine can power the box (`no_controller`), or its controller is not connected (`controller_offline`)',
  ),
  422: errorResponse('The machine is not an Airia devbox (`not_a_vm`)'),
  502: jsonResponse(
    "The controller ran the command and it failed (`power_failed`): `driverCode` is the driver's code, `message` its plain words",
    PowerFailedSchema,
  ),
};

const route = <P extends CompanyPath>(deps: ServerDeps, role: MembershipRole, path: P) =>
  companyRoute(deps, { role, path, tag: 'machines' });

const getRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'viewer', `${MACHINE}/power`);
  return createRoute({
    ...base,
    method: 'get',
    summary: "A machine's power: its policy, hold, box and controller (viewer and above)",
    request: { params: MachineParamsSchema },
    responses: { 200: jsonResponse('Its power', MachinePowerSchema), 401: refusals[401], 404: NO_MACHINE },
  });
};

const putRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'admin', `${MACHINE}/power`);
  return createRoute({
    ...base,
    method: 'put',
    summary: "Change a machine's power policy (admin and above)",
    description:
      'Every field has its default, so `{}` is the policy a new machine has. The hold follows at once.',
    request: { params: MachineParamsSchema, body: jsonBody(MachinePowerPolicy) },
    responses: {
      200: jsonResponse('Its power, with the new policy', MachinePowerSchema),
      400: INVALID,
      ...refusals,
      404: NO_MACHINE,
    },
  });
};

const actionRoute = <A extends 'start' | 'stop'>(deps: ServerDeps, action: A) => {
  const { base, refusals } = route(deps, 'admin', `${MACHINE}/power/${action}`);
  return createRoute({
    ...base,
    method: 'post',
    summary: `${action === 'start' ? 'Start' : 'Stop'} a devbox through its controller, or a container runner's container (admin and above)`,
    description:
      'A devbox: waits for the controller to run the command (a start may take a few minutes); the box is then ' +
      'usually still `starting` or `stopping`. A box with no controller gets the one connected machine that can ' +
      "power it. A container runner: this server runs `docker start`, or `docker stop` with the container's grace " +
      'period (90 s), with the Docker CLI of the computer running it (MWC_LOCAL_DOCKER), holding the machine for the ' +
      'time; a Stop is refused while chat turns or terminals run on it unless `force`.',
    request: {
      params: MachineParamsSchema,
      body: { content: { 'application/json': { schema: PowerActionBodySchema } }, required: false },
    },
    responses: {
      202: jsonResponse('Its power after the command', MachinePowerSchema),
      ...refusals,
      404: NO_MACHINE,
      ...CONTROL_REFUSALS,
      409: jsonResponse(
        'A devbox: no connected machine can power it (`no_controller`), or its controller is not connected ' +
          '(`controller_offline`). A container: this server has no Docker CLI (`power_unsupported`) or no container ' +
          'of it was found (`container_missing`), both with the `command` to run by hand; another job, chat turns or ' +
          'terminals run on it (`machine_busy`)',
        PowerRefusalSchema,
      ),
      422: errorResponse('The machine is neither an Airia devbox nor a container (`not_a_vm`)'),
    },
  });
};

const timezoneRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'admin', `${MACHINE}/power/timezone`);
  return createRoute({
    ...base,
    method: 'post',
    summary: "Set the devbox's own time zone (admin and above)",
    description:
      "The box's `devbox-tz`, which its own idle and nightly rules use; set through its controller.",
    request: { params: MachineParamsSchema, body: jsonBody(PowerTimezoneSchema) },
    responses: {
      200: jsonResponse('Its power, with the new time zone', MachinePowerSchema),
      400: INVALID,
      ...refusals,
      404: NO_MACHINE,
      ...CONTROL_REFUSALS,
    },
  });
};

const eventsRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'viewer', `${MACHINE}/events`);
  return createRoute({
    ...base,
    method: 'get',
    summary: "A machine's power log, newest first (viewer and above)",
    request: { params: MachineParamsSchema, query: PowerEventsQuerySchema },
    responses: {
      200: jsonResponse('Its last events (10 unless `limit` says up to 100)', PowerEventsSchema),
      400: INVALID,
      401: refusals[401],
      404: NO_MACHINE,
    },
  });
};

const callerOf = (membership: MemberContext): PowerCaller => ({
  principalId: membership.principalId,
  userId: membership.userId,
  role: membership.role,
});

/** A refusal in the common error shape; a 502 also carries the driver's code, a 409 the command to run when it has one. */
function refusal(c: Context<MemberEnv>, result: Refusal<404 | 409 | 422> | PowerFailure | ByHand) {
  if (result.status === 409 && 'command' in result) {
    const error = { code: result.code, message: result.message, requestId: c.var.requestId };
    return c.json({ error: { ...error, command: result.command } }, 409);
  }
  if (result.status !== 502) return errorJson(c, result.status, result.code, result.message);
  const error = { code: 'power_failed' as const, message: result.message, requestId: c.var.requestId };
  return c.json({ error: { ...error, driverCode: result.driverCode } }, 502);
}

export function powerRoutes(deps: ServerDeps, power: PowerService) {
  const act = <A extends 'start' | 'stop'>(action: A) =>
    newRouter().openapi(actionRoute(deps, action), async (c) => {
      const { machineId } = c.req.valid('param');
      const force = c.req.valid('json').force === true;
      const result = await power.power(c.var.tenant, callerOf(c.var.membership), machineId, action, {
        force,
      });
      return result.ok ? c.json(result.power, 202) : refusal(c, result);
    });
  return newRouter()
    .openapi(getRoute(deps), async (c) => {
      const result = await power.view(c.var.tenant, c.req.valid('param').machineId, c.var.membership.role);
      return result.ok ? c.json(result.power, 200) : errorJson(c, 404, result.code, result.message);
    })
    .openapi(putRoute(deps), async (c) => {
      const { machineId } = c.req.valid('param');
      const policy = c.req.valid('json');
      const result = await power.setPolicy(c.var.tenant, callerOf(c.var.membership), machineId, policy);
      return result.ok ? c.json(result.power, 200) : errorJson(c, 404, result.code, result.message);
    })
    .route('/', act('start'))
    .route('/', act('stop'))
    .openapi(timezoneRoute(deps), async (c) => {
      const { machineId } = c.req.valid('param');
      const { timezone } = c.req.valid('json');
      const result = await power.setTimezone(c.var.tenant, callerOf(c.var.membership), machineId, timezone);
      return result.ok ? c.json(result.power, 200) : refusal(c, result);
    })
    .openapi(eventsRoute(deps), async (c) => {
      const { machineId } = c.req.valid('param');
      const result = await power.events(c.var.tenant, machineId, c.req.valid('query').limit);
      return result.ok
        ? c.json({ events: result.events }, 200)
        : errorJson(c, 404, result.code, result.message);
    });
}
