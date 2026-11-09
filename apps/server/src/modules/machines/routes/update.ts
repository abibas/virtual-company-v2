import { createRoute } from '@hono/zod-openapi';
import { companyRoute } from '../../../platform/auth/membership.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { RunnerUpdateRefusalSchema, RunnerUpdateSchema } from '../schemas/update.ts';
import { MachineParamsSchema } from '../schemas.ts';
import type { RunnerHub } from '../service/hub.ts';
import type { PowerControl } from '../service/power/control.ts';
import { updateRunner } from '../service/update.ts';

/**
 * `POST /api/companies/{companyId}/machines/{machineId}/runner-update` (docs/machines.md, "Updating a runner"): the
 * "Update runner" button, for admins and owners. Another company's machine is a 404.
 */

const updateRoute = (deps: ServerDeps) => {
  const { base, refusals } = companyRoute(deps, {
    role: 'admin',
    path: '/api/companies/{companyId}/machines/{machineId}/runner-update' as const,
    tag: 'machines',
  });
  return createRoute({
    ...base,
    method: 'post',
    summary: "Update a machine's runner to the build this server hands out (admin and above)",
    description:
      'A connected runner that updates itself downloads the new bundle and PTY, checks their SHA-256, answers and ' +
      'restarts (`self_update`); an Airia devbox runner too old for that is reinstalled by this server over SSH while ' +
      'the box runs, when the server drives the airia CLI itself (`ssh_reinstall`, up to 3 minutes). Either way the ' +
      'runner reconnects on its new build moments later. Audited.',
    request: { params: MachineParamsSchema },
    responses: {
      202: jsonResponse('What was done; the runner restarts on the new build', RunnerUpdateSchema),
      ...refusals,
      404: errorResponse(
        'No such company, or not an active member of it (`not_found`), or no such machine in it (`machine_not_found`)',
      ),
      409: jsonResponse(
        'The runner is not connected and its box is not running (`machine_offline`), has live work (`runner_busy`), or neither path updates it (`update_unsupported`, with the `command` to run on the machine)',
        RunnerUpdateRefusalSchema,
      ),
      502: errorResponse('The update was tried and failed (`update_failed`); the runner goes on as it was'),
    },
  });
};

export function runnerUpdateRoutes(
  deps: ServerDeps & { readonly hub: RunnerHub; readonly control: PowerControl },
) {
  const update = {
    hub: deps.hub,
    control: deps.control,
    apiUrl: deps.config.MWC_PUBLIC_URL.replace(/\/+$/, ''),
    apiPort: deps.config.MWC_PORT,
  };
  return newRouter().openapi(updateRoute(deps), async (c) => {
    const { principalId } = c.var.membership;
    const caller = { principalId, requestId: c.var.requestId };
    const result = await updateRunner(update, c.var.tenant, caller, c.req.valid('param').machineId);
    if (result.ok) return c.json({ path: result.path, build: result.build }, 202);
    if (!('command' in result)) return errorJson(c, result.status, result.code, result.message);
    const error = { code: result.code, message: result.message, requestId: c.var.requestId };
    return c.json({ error: { ...error, command: result.command } }, 409);
  });
}
