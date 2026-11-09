import { createRoute } from '@hono/zod-openapi';
import type { MembershipRole } from '@mwc/shared/enums';
import type { MiddlewareHandler } from 'hono';
import { companyRoute } from '../../../platform/auth/membership.ts';
import type { AppEnv, ServerDeps } from '../../../platform/env.ts';
import { jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { logoBodyLimit, sendLogo } from '../../companies/routes/logo.ts';
import { LogoImageSchema, LogoQuerySchema, LogoSchema, LogoUploadSchema } from '../../companies/schemas.ts';
import { MachineParamsSchema } from '../schemas.ts';
import { machineLogoFile, removeMachineLogo, uploadMachineLogo } from '../service/logo.ts';

/**
 * `PUT`, `GET` and `DELETE /api/companies/{companyId}/machines/{machineId}/logo`: a machine's logo, as a company's
 * (`companies/routes/logo.ts`, whose limits, checks and image answer it shares). Setting and removing it is for admins
 * and above, reading it for any member. Another company's machine, or a removed one, is a 404.
 */

const LOGO = '/api/companies/{companyId}/machines/{machineId}/logo' as const;
const NO_MACHINE =
  'No such company, or not an active member of it (`not_found`), or no such machine in it (`machine_not_found`)';

const logoRoute = (deps: ServerDeps, role: MembershipRole) =>
  companyRoute(deps, { role, path: LOGO, tag: 'machines' });

const putRoute = (deps: ServerDeps) => {
  const { base, refusals } = logoRoute(deps, 'admin');
  // After the guard (nothing is read for a caller it refuses), before the form is parsed.
  const middleware: [...typeof base.middleware, MiddlewareHandler<AppEnv>] = [
    ...base.middleware,
    logoBodyLimit,
  ];
  return createRoute({
    ...base,
    middleware,
    method: 'put',
    summary: "Set or replace a machine's logo (admin and above)",
    description:
      'A multipart form with one file, `file`: a PNG, JPEG or WebP image of at most 1 MB, told from its first bytes ' +
      '(no SVG, no GIF), as for the company logo. The image is stored in the database.',
    request: {
      params: MachineParamsSchema,
      body: { content: { 'multipart/form-data': { schema: LogoUploadSchema } }, required: true },
    },
    responses: {
      200: jsonResponse('The logo stored', LogoSchema),
      400: errorResponse('An empty file (`logo_empty`), or no `file` in the form (`invalid_request`)'),
      ...refusals,
      404: errorResponse(NO_MACHINE),
      413: errorResponse('The file is over 1 MB (`logo_too_large`)'),
      415: errorResponse('Not a PNG, JPEG or WebP image (`logo_type_unsupported`), or not a form'),
    },
  });
};

const getRoute = (deps: ServerDeps) => {
  const { base, refusals } = logoRoute(deps, 'viewer');
  const image = { schema: LogoImageSchema };
  return createRoute({
    ...base,
    method: 'get',
    summary: "A machine's logo image (any member)",
    description:
      'Answered as the company logo is: its stored `Content-Type`, `ETag: "<sha256>"`, cached for good with `?v=` ' +
      'equal to the version the machine names (`logo.version`), otherwise revalidated; a matching `If-None-Match` is ' +
      'a 304.',
    request: { params: MachineParamsSchema, query: LogoQuerySchema },
    responses: {
      200: {
        description: 'The logo',
        content: { 'image/png': image, 'image/jpeg': image, 'image/webp': image },
      },
      304: { description: 'Not modified: `If-None-Match` names the current logo' },
      401: refusals[401],
      404: errorResponse(`${NO_MACHINE}, or the machine has no logo (\`logo_not_found\`)`),
    },
  });
};

const deleteRoute = (deps: ServerDeps) => {
  const { base, refusals } = logoRoute(deps, 'admin');
  return createRoute({
    ...base,
    method: 'delete',
    summary: "Remove a machine's logo (admin and above); a machine without one is fine",
    request: { params: MachineParamsSchema },
    responses: {
      204: { description: 'Removed, or there was none' },
      ...refusals,
      404: errorResponse(NO_MACHINE),
    },
  });
};

/** Who acts: the guard's membership and the request id. */
const callerOf = (v: { membership: { principalId: string }; requestId: string }) => ({
  principalId: v.membership.principalId,
  requestId: v.requestId,
});

export function machineLogoRoutes(deps: ServerDeps) {
  return newRouter()
    .openapi(putRoute(deps), async (c) => {
      const { machineId } = c.req.valid('param');
      const result = await uploadMachineLogo(
        c.var.tenant,
        callerOf(c.var),
        machineId,
        c.req.valid('form').file,
      );
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json({ logo: result.logo }, 200);
    })
    .openapi(getRoute(deps), async (c) => {
      const result = await machineLogoFile(c.var.tenant, c.req.valid('param').machineId);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      if (result.logo === undefined) return errorJson(c, 404, 'logo_not_found', 'This machine has no logo');
      return sendLogo(c, result.logo, c.req.valid('query').v);
    })
    .openapi(deleteRoute(deps), async (c) => {
      const result = await removeMachineLogo(c.var.tenant, callerOf(c.var), c.req.valid('param').machineId);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.body(null, 204);
    });
}
