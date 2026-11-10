import { createRoute } from '@hono/zod-openapi';
import { companyRoute } from '../../../platform/auth/membership.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { COMPOSE_FILE } from '../../health/service.ts';
import { RunnerUpdateBodySchema } from '../schemas/jobs.ts';
import { RunnerUpdateRefusalSchema, RunnerUpdateSchema } from '../schemas/update.ts';
import { MachineParamsSchema } from '../schemas.ts';
import type { MachineJobs } from '../service/jobs.ts';
import type { PowerControl } from '../service/power/control.ts';
import type { RunnerHub } from '../service/runner/hub.ts';
import { updateRunner } from '../service/runner/update.ts';

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
      'the box runs, when the server drives the airia CLI itself (`ssh_reinstall`, up to 3 minutes); a container is ' +
      'rebuilt by this server with the Docker CLI of the computer running it (`docker_rebuild`, MWC_LOCAL_DOCKER): it ' +
      'answers at once and rebuilds in the background (`runner.job` shows its progress, `runner.updateFailure` a ' +
      'failure). Either way the runner reconnects on its new build. Audited. One job at a time per machine: refused while a tool ' +
      'install or another update runs (until the runner is back on its new build), and while chat turns or terminals ' +
      'run on the machine unless `force` (the web never sends it).',
    request: {
      params: MachineParamsSchema,
      body: { content: { 'application/json': { schema: RunnerUpdateBodySchema } }, required: false },
    },
    responses: {
      202: jsonResponse('What was done; the runner restarts on the new build', RunnerUpdateSchema),
      ...refusals,
      404: errorResponse(
        'No such company, or not an active member of it (`not_found`), or no such machine in it (`machine_not_found`)',
      ),
      409: jsonResponse(
        'Another job runs on the machine, or chat turns or terminals do (`machine_busy`, naming them); the runner is not connected and its box is not running (`machine_offline`), refused for its live work (`runner_busy`), or neither path updates it (`update_unsupported`, with the `command` to run on the machine)',
        RunnerUpdateRefusalSchema,
      ),
      502: errorResponse(
        'The update was tried and failed, or Docker did not answer (`update_failed`); the runner goes on as it was',
      ),
    },
  });
};

export function runnerUpdateRoutes(
  deps: ServerDeps & {
    readonly hub: RunnerHub;
    readonly control: PowerControl;
    readonly machineJobs: MachineJobs;
  },
) {
  const update = {
    hub: deps.hub,
    control: deps.control,
    jobs: deps.machineJobs,
    apiUrl: deps.config.MWC_PUBLIC_URL.replace(/\/+$/, ''),
    apiPort: deps.config.MWC_PORT,
    composeFile: deps.config.NODE_ENV === 'production' ? null : COMPOSE_FILE,
    docker: deps.localDocker,
    logger: deps.logger,
  };
  return newRouter().openapi(updateRoute(deps), async (c) => {
    const { principalId } = c.var.membership;
    const caller = { principalId, requestId: c.var.requestId };
    const { machineId } = c.req.valid('param');
    const force = c.req.valid('json').force === true;
    const result = await updateRunner(update, c.var.tenant, caller, machineId, { force });
    if (result.ok) return c.json({ path: result.path, build: result.build }, 202);
    if (!('command' in result)) return errorJson(c, result.status, result.code, result.message);
    const error = { code: result.code, message: result.message, requestId: c.var.requestId };
    return c.json({ error: { ...error, command: result.command } }, 409);
  });
}
