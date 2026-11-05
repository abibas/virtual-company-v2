import { createRoute } from '@hono/zod-openapi';
import type { MembershipRole } from '@mwc/shared/enums';
import { LOGO_MAX_BYTES, logoVersion } from '@mwc/shared/logos';
import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { companyRoute } from '../../../platform/auth/membership.ts';
import type { AppEnv, ServerDeps } from '../../../platform/env.ts';
import { jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import {
  CompanyParamsSchema,
  LogoImageSchema,
  LogoQuerySchema,
  LogoSchema,
  LogoUploadSchema,
} from '../schemas.ts';
import { LOGO_TOO_LARGE, logoFile, removeLogo, uploadLogo } from '../service/logo.ts';

/**
 * `PUT`, `GET` and `DELETE /api/companies/{companyId}/logo`: set or replace the company's logo (admin and above), read
 * it (any member, viewers included) and remove it (admin and above). API keys and session tokens alike.
 */

const logoRoute = (deps: ServerDeps, role: MembershipRole) =>
  companyRoute(deps, { role, path: '/api/companies/{companyId}/logo', tag: 'companies' });

/** Room for the multipart framing around the file (boundaries, the part's headers, its file name). */
const MULTIPART_ALLOWANCE = 16 * 1024;
/** A year: how long a logo asked for by its current version may be kept (the version changes with the logo). */
const IMMUTABLE = 'private, max-age=31536000, immutable';
const REVALIDATE = 'private, no-cache';
const NOT_FOUND =
  'No such company, a deleted one, or one the caller is not an active member of (`not_found`)';

/** Refuses a body over 1 MB and its framing before anything parses it: 413 `logo_too_large`. */
const logoBodyLimit: MiddlewareHandler<AppEnv> = bodyLimit({
  maxSize: LOGO_MAX_BYTES + MULTIPART_ALLOWANCE,
  onError: (c) => errorJson(c, LOGO_TOO_LARGE.status, LOGO_TOO_LARGE.code, LOGO_TOO_LARGE.message),
});

const putLogoRoute = (deps: ServerDeps) => {
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
    summary: 'Set or replace the company logo (admin and above)',
    description:
      'A multipart form with one file, `file`: a PNG, JPEG or WebP image of at most 1 MB. Its type is told from its ' +
      'first bytes, never from its declared type or name (no SVG, no GIF). The image is stored in the database.',
    request: {
      params: CompanyParamsSchema,
      body: { content: { 'multipart/form-data': { schema: LogoUploadSchema } }, required: true },
    },
    responses: {
      200: jsonResponse('The logo stored', LogoSchema),
      400: errorResponse('An empty file (`logo_empty`), or no `file` in the form (`invalid_request`)'),
      ...refusals,
      413: errorResponse('The file is over 1 MB (`logo_too_large`)'),
      415: errorResponse('Not a PNG, JPEG or WebP image (`logo_type_unsupported`), or not a form'),
    },
  });
};

const getLogoRoute = (deps: ServerDeps) => {
  const { base, refusals } = logoRoute(deps, 'viewer');
  const image = { schema: LogoImageSchema };
  return createRoute({
    ...base,
    method: 'get',
    summary: 'The company logo image (any member)',
    description:
      'The image with its stored `Content-Type`, `ETag: "<sha256>"`, `X-Content-Type-Options: nosniff`, ' +
      "`Content-Security-Policy: default-src 'none'` and `Content-Disposition: inline`. With `?v=` equal to the " +
      'current version (from the company or `GET /api/me`) it may be cached for good (`private, max-age=31536000, ' +
      'immutable`), otherwise it is revalidated (`private, no-cache`); a matching `If-None-Match` is a 304.',
    request: { params: CompanyParamsSchema, query: LogoQuerySchema },
    responses: {
      200: {
        description: 'The logo',
        content: { 'image/png': image, 'image/jpeg': image, 'image/webp': image },
      },
      304: { description: 'Not modified: `If-None-Match` names the current logo' },
      401: refusals[401],
      404: errorResponse(`${NOT_FOUND}, or the company has no logo (\`logo_not_found\`)`),
    },
  });
};

const deleteLogoRoute = (deps: ServerDeps) => {
  const { base, refusals } = logoRoute(deps, 'admin');
  return createRoute({
    ...base,
    method: 'delete',
    summary: 'Remove the company logo (admin and above); a company without one is fine',
    request: { params: CompanyParamsSchema },
    responses: { 204: { description: 'Removed, or there was none' }, ...refusals },
  });
};

/** Whether `If-None-Match` names this ETag (a weak comparison, as for this header) or is `*`. */
function etagMatches(header: string | undefined, etag: string): boolean {
  return (header ?? '').split(',').some((tag) => {
    const trimmed = tag.trim();
    return trimmed === '*' || trimmed.replace(/^W\//, '') === etag;
  });
}

export function logoRoutes(deps: ServerDeps) {
  return newRouter()
    .openapi(putLogoRoute(deps), async (c) => {
      const { tenant, membership, requestId } = c.var;
      const result = await uploadLogo(tenant, membership.principalId, c.req.valid('form').file, requestId);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json({ logo: result.logo }, 200);
    })
    .openapi(getLogoRoute(deps), async (c) => {
      const logo = await logoFile(c.var.tenant);
      if (logo === undefined) return errorJson(c, 404, 'logo_not_found', 'This company has no logo');
      const etag = `"${logo.sha256}"`;
      const headers = {
        etag,
        'cache-control': c.req.valid('query').v === logoVersion(logo.sha256) ? IMMUTABLE : REVALIDATE,
        'x-content-type-options': 'nosniff',
      };
      if (etagMatches(c.req.header('if-none-match'), etag)) return c.body(null, 304, headers);
      return c.body(new Uint8Array(logo.bytes), 200, {
        ...headers,
        'content-type': logo.contentType,
        'content-security-policy': "default-src 'none'",
        'content-disposition': 'inline',
      });
    })
    .openapi(deleteLogoRoute(deps), async (c) => {
      await removeLogo(c.var.tenant, c.var.membership.principalId, c.var.requestId);
      return c.body(null, 204);
    });
}
