import { createRoute } from '@hono/zod-openapi';
import { companyRoute } from '../../../platform/auth/membership.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import {
  ToolInstallBodySchema,
  ToolInstallParamsSchema,
  ToolInstallQuerySchema,
  ToolInstallSchema,
  ToolInstallStartedSchema,
  ToolsCheckedSchema,
} from '../schemas/tools.ts';
import { MachineParamsSchema } from '../schemas.ts';
import type { RunnerHub } from '../service/runner/hub.ts';
import { toolInstalls } from '../service/tools/installs.ts';
import { checkTools, installStatus, startInstall } from '../service/tools.ts';

/**
 * `/api/companies/{companyId}/machines/{machineId}/tools/…` (docs/machines.md, "Tools"): Check again, and Install (or
 * update) Claude Code or Codex through the machine's runner with its output, for admins and owners. Another company's
 * machine is a 404.
 */

const TOOLS = '/api/companies/{companyId}/machines/{machineId}/tools' as const;
const NO_MACHINE = errorResponse(
  'No such company, or not an active member of it (`not_found`), or no such machine in it (`machine_not_found`)',
);

const checkRoute = (deps: ServerDeps) => {
  const { base, refusals } = companyRoute(deps, { role: 'admin', path: `${TOOLS}/check`, tag: 'machines' });
  return createRoute({
    ...base,
    method: 'post',
    summary: "Have a machine's runner look for its CLIs again (admin and above)",
    description:
      'Claude Code, Codex, git, gh and Docker, each found on its PATH or in the usual folders and asked its version. The ' +
      'machines list follows at once.',
    request: { params: MachineParamsSchema },
    responses: {
      200: jsonResponse('The CLIs it found', ToolsCheckedSchema),
      ...refusals,
      404: NO_MACHINE,
      409: errorResponse(
        'The runner is not connected (`machine_offline`) or is older than the tools (`runner_outdated`)',
      ),
      504: errorResponse('The runner did not answer within 45 seconds (`runner_timeout`)'),
    },
  });
};

const installRoute = (deps: ServerDeps) => {
  const { base, refusals } = companyRoute(deps, { role: 'admin', path: `${TOOLS}/install`, tag: 'machines' });
  return createRoute({
    ...base,
    method: 'post',
    summary: 'Install or update Claude Code or Codex on a machine (admin and above)',
    description:
      "The runner runs `npm install -g --prefix ~/.local <package>@<this server's pin>` with the npm beside its Node, as " +
      'its user (never sudo), so the command lands in ~/.local/bin; up to 10 minutes. It starts at once: read its ' +
      'output and its end with `GET …/tools/install/{installId}`. Audited when it ends.',
    request: { params: MachineParamsSchema, body: jsonBody(ToolInstallBodySchema) },
    responses: {
      202: jsonResponse('It started', ToolInstallStartedSchema),
      400: errorResponse('Not `claude` or `codex` (`invalid_request`)'),
      ...refusals,
      404: NO_MACHINE,
      409: errorResponse(
        'The runner is not connected (`machine_offline`), is older than the tools (`runner_outdated`), installs ' +
          'already (`busy`), or is a container, whose image is rebuilt instead (`unsupported`)',
      ),
    },
  });
};

const statusRoute = (deps: ServerDeps) => {
  const { base, refusals } = companyRoute(deps, {
    role: 'admin',
    path: `${TOOLS}/install/{installId}`,
    tag: 'machines',
  });
  return createRoute({
    ...base,
    method: 'get',
    summary: 'An install: its state, its output so far and its end (admin and above)',
    request: { params: ToolInstallParamsSchema, query: ToolInstallQuerySchema },
    responses: {
      200: jsonResponse('The install', ToolInstallSchema),
      ...refusals,
      404: errorResponse(
        'No such company or membership (`not_found`), or no such install of this machine (`install_not_found`): ' +
          'the server keeps them an hour and forgets them when it restarts',
      ),
    },
  });
};

export function toolRoutes(deps: ServerDeps & { readonly hub: RunnerHub }) {
  const tools = { hub: deps.hub, installs: toolInstalls(deps.clock), logger: deps.logger };
  return newRouter()
    .openapi(checkRoute(deps), async (c) => {
      const result = await checkTools(tools, c.var.tenant, c.req.valid('param').machineId);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json({ tools: result.tools }, 200);
    })
    .openapi(installRoute(deps), async (c) => {
      const caller = { principalId: c.var.membership.principalId, requestId: c.var.requestId };
      const target = { machineId: c.req.valid('param').machineId, tool: c.req.valid('json').tool };
      const result = await startInstall(tools, c.var.tenant, caller, target);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      const { id: installId, tool, version } = result.install;
      return c.json({ installId, tool, version }, 202);
    })
    .openapi(statusRoute(deps), async (c) => {
      const { machineId, installId } = c.req.valid('param');
      const result = installStatus(tools, c.var.tenant, machineId, installId, c.req.valid('query').from);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.install, 200);
    });
}
