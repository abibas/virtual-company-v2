import { createRoute } from '@hono/zod-openapi';
import { companyRoute } from '../../../platform/auth/membership.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import {
  FolderListSchema,
  FoldersQuerySchema,
  MadeFolderSchema,
  MakeFolderSchema,
} from '../schemas/folders.ts';
import { MachineParamsSchema } from '../schemas.ts';
import { listFolders, makeFolder } from '../service/folders.ts';
import type { RunnerHub } from '../service/runner/hub.ts';

/**
 * `/api/companies/{companyId}/machines/{machineId}/folders` (S5.1d, docs/machines.md "The folder browser"): a machine's
 * folders read through its runner, and a new folder there, for choosing an agent's home folder; for admins and owners.
 * Another company's machine is a 404.
 */

const FOLDERS = '/api/companies/{companyId}/machines/{machineId}/folders' as const;
const NO_MACHINE = errorResponse(
  'No such company, or not an active member of it (`not_found`), or no such machine in it (`machine_not_found`)',
);
const NOT_READY = errorResponse(
  "The machine's runner is not connected (`machine_offline`), or is older than the folder browser, or than making a " +
    "folder's parents (`runner_outdated`)",
);
const REFUSED = errorResponse(
  'The runner refused, in plain words: `folder_not_found`, `not_a_directory`, `permission_denied`, `outside_volume` ' +
    '(a Docker runner keeps its folders under /work), `outside_roots` (with `parents`, outside the runner user’s ' +
    'home), `folder_exists`, `invalid_path` or `folder_failed`',
);
const TIMED_OUT = errorResponse('The runner did not answer within 10 seconds (`runner_timeout`)');

const route = (deps: ServerDeps) => companyRoute(deps, { role: 'admin', path: FOLDERS, tag: 'machines' });

const listRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps);
  return createRoute({
    ...base,
    method: 'get',
    summary: 'The folders in a folder of a machine, read by its runner (admin and above)',
    description:
      'Folders only (dot-folders left out, sorted, at most 500), each marked when it is a git checkout or holds a ' +
      "CLAUDE.md, with the runner user's home and where agents' home folders go by default. In a Docker runner every " +
      'path stays in its work volume, /work.',
    request: { params: MachineParamsSchema, query: FoldersQuerySchema },
    responses: {
      200: jsonResponse('The folder and its folders', FolderListSchema),
      400: errorResponse('The path is not absolute (`invalid_request`)'),
      ...refusals,
      404: NO_MACHINE,
      409: NOT_READY,
      422: REFUSED,
      504: TIMED_OUT,
    },
  });
};

const makeRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps);
  return createRoute({
    ...base,
    method: 'post',
    summary: 'Make a folder on a machine, through its runner (admin and above)',
    description:
      'One folder (0755) whose parent exists, as the runner user; with `parents`, the folder and its missing parents ' +
      'inside the runner’s roots (a container’s /work, else its user’s home), and one already there is a 200. ' +
      'Audited when made.',
    request: { params: MachineParamsSchema, body: jsonBody(MakeFolderSchema) },
    responses: {
      200: jsonResponse('The folder was there already (with `parents`)', MadeFolderSchema),
      201: jsonResponse('The new folder', MadeFolderSchema),
      400: errorResponse('The path is not absolute (`invalid_request`)'),
      ...refusals,
      404: NO_MACHINE,
      409: NOT_READY,
      422: REFUSED,
      504: TIMED_OUT,
    },
  });
};

export function folderRoutes(deps: ServerDeps & { readonly hub: RunnerHub }) {
  const folders = { hub: deps.hub };
  return newRouter()
    .openapi(listRoute(deps), async (c) => {
      const { machineId } = c.req.valid('param');
      const result = await listFolders(folders, c.var.tenant, machineId, c.req.valid('query').path ?? null);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      const { ok: _ok, ...listing } = result;
      return c.json(listing, 200);
    })
    .openapi(makeRoute(deps), async (c) => {
      const caller = { principalId: c.var.membership.principalId, requestId: c.var.requestId };
      const { machineId } = c.req.valid('param');
      const result = await makeFolder(folders, c.var.tenant, caller, machineId, c.req.valid('json'));
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      const made = { path: result.path, created: result.created };
      return result.created ? c.json(made, 201) : c.json(made, 200);
    });
}
