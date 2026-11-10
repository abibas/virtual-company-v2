import { createRoute } from '@hono/zod-openapi';
import type { MembershipRole } from '@mwc/shared/enums';
import { LOGO_MAX_BYTES } from '@mwc/shared/logos';
import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { companyRoute } from '../../../platform/auth/membership.ts';
import type { AppEnv, ServerDeps } from '../../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { sendLogo } from '../../companies/routes/logo.ts';
import { LogoImageSchema, LogoQuerySchema } from '../../companies/schemas.ts';
import { ICON_TOO_LARGE } from '../rules/icons.ts';
import { AgentIconResultSchema, IconUploadSchema, SetAgentIconSchema } from '../schemas/icons.ts';
import { AgentParamsSchema } from '../schemas.ts';
import { callerOf } from '../service/audit.ts';
import { agentIconFile, setAgentIcon, uploadAgentIcon } from '../service/icons.ts';

/**
 * `PUT`, `PATCH`, `GET` and `DELETE /api/companies/{companyId}/agents/{agentId}/icon` (docs/architecture.md, "Agent
 * icons"): upload an image, choose the face or an emoji, read the image, go back to the face. Changing it is for
 * admins and above, reading it for any member; the image is answered as a logo is (`sendLogo`: its ETag, cached for
 * good by its version, `nosniff`, a CSP that runs nothing). Another company's agent is a 404.
 */

const ICON = '/api/companies/{companyId}/agents/{agentId}/icon' as const;
const NO_AGENT =
  'No such company, or not an active member of it (`not_found`), or no such agent in it (`agent_not_found`)';
/** Room for the multipart framing around the file (boundaries, the part's headers, its file name). */
const MULTIPART_ALLOWANCE = 16 * 1024;

/** Refuses a body over 1 MB and its framing before anything parses it: 413 `icon_too_large`. */
const iconBodyLimit: MiddlewareHandler<AppEnv> = bodyLimit({
  maxSize: LOGO_MAX_BYTES + MULTIPART_ALLOWANCE,
  onError: (c) => errorJson(c, ICON_TOO_LARGE.status, ICON_TOO_LARGE.code, ICON_TOO_LARGE.message),
});

const iconRoute = (deps: ServerDeps, role: MembershipRole) =>
  companyRoute(deps, { role, path: ICON, tag: 'agents' });

const putRoute = (deps: ServerDeps) => {
  const { base, refusals } = iconRoute(deps, 'admin');
  // After the guard (nothing is read for a caller it refuses), before the form is parsed.
  const middleware: [...typeof base.middleware, MiddlewareHandler<AppEnv>] = [
    ...base.middleware,
    iconBodyLimit,
  ];
  return createRoute({
    ...base,
    middleware,
    method: 'put',
    summary: "Set an agent's icon to an uploaded image (admin and above)",
    description:
      'A multipart form with one file, `file`: a PNG, JPEG, WebP or GIF image of at most 1 MB, told from its first ' +
      'bytes (no SVG). The image is stored in the database and replaces the face or emoji.',
    request: {
      params: AgentParamsSchema,
      body: { content: { 'multipart/form-data': { schema: IconUploadSchema } }, required: true },
    },
    responses: {
      200: jsonResponse('The icon after the change', AgentIconResultSchema),
      400: errorResponse('An empty file (`icon_empty`), or no `file` in the form (`invalid_request`)'),
      ...refusals,
      404: errorResponse(NO_AGENT),
      413: errorResponse('The file is over 1 MB (`icon_too_large`)'),
      415: errorResponse('Not a PNG, JPEG, WebP or GIF image (`icon_type_unsupported`), or not a form'),
    },
  });
};

const patchRoute = (deps: ServerDeps) => {
  const { base, refusals } = iconRoute(deps, 'admin');
  return createRoute({
    ...base,
    method: 'patch',
    summary: "Set an agent's icon to its drawn face or an emoji (admin and above)",
    description:
      'One emoji (a single grapheme of at most 16 code points); its uploaded image, if any, is removed.',
    request: { params: AgentParamsSchema, body: jsonBody(SetAgentIconSchema) },
    responses: {
      200: jsonResponse('The icon after the change', AgentIconResultSchema),
      400: errorResponse(
        'The request does not match the schema, or the emoji is not one emoji (`invalid_request`)',
      ),
      ...refusals,
      404: errorResponse(NO_AGENT),
    },
  });
};

const getRoute = (deps: ServerDeps) => {
  const { base, refusals } = iconRoute(deps, 'viewer');
  const image = { schema: LogoImageSchema };
  return createRoute({
    ...base,
    method: 'get',
    summary: "An agent's icon image (any member)",
    description:
      'Answered as the company logo is: its stored `Content-Type`, `ETag: "<sha256>"`, cached for good with `?v=` ' +
      'equal to the version the agent names (`icon.version`), otherwise revalidated; a matching `If-None-Match` is a 304.',
    request: { params: AgentParamsSchema, query: LogoQuerySchema },
    responses: {
      200: {
        description: 'The image',
        content: { 'image/png': image, 'image/jpeg': image, 'image/webp': image, 'image/gif': image },
      },
      304: { description: 'Not modified: `If-None-Match` names the current image' },
      401: refusals[401],
      404: errorResponse(`${NO_AGENT}, or the agent's icon is not an image (\`icon_not_found\`)`),
    },
  });
};

const deleteRoute = (deps: ServerDeps) => {
  const { base, refusals } = iconRoute(deps, 'admin');
  return createRoute({
    ...base,
    method: 'delete',
    summary: "Set an agent's icon back to its drawn face (admin and above), removing its image",
    request: { params: AgentParamsSchema },
    responses: {
      204: { description: 'Its face again, or it was already' },
      ...refusals,
      404: errorResponse(NO_AGENT),
    },
  });
};

/** The routes of an agent's icon, mounted by the org module's agent routes. */
export function agentIconRoutes(deps: ServerDeps) {
  return newRouter()
    .openapi(putRoute(deps), async (c) => {
      const { agentId } = c.req.valid('param');
      const result = await uploadAgentIcon(c.var.tenant, callerOf(c.var), agentId, c.req.valid('form').file);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json({ icon: result.icon }, 200);
    })
    .openapi(patchRoute(deps), async (c) => {
      const { agentId } = c.req.valid('param');
      const result = await setAgentIcon(c.var.tenant, callerOf(c.var), agentId, c.req.valid('json'));
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json({ icon: result.icon }, 200);
    })
    .openapi(getRoute(deps), async (c) => {
      const result = await agentIconFile(c.var.tenant, c.req.valid('param').agentId);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      if (result.icon === undefined)
        return errorJson(c, 404, 'icon_not_found', "This agent's icon is not an image");
      return sendLogo(c, result.icon, c.req.valid('query').v);
    })
    .openapi(deleteRoute(deps), async (c) => {
      const { agentId } = c.req.valid('param');
      const result = await setAgentIcon(c.var.tenant, callerOf(c.var), agentId, { kind: 'face' });
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.body(null, 204);
    });
}
