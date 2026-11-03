import { createRoute, z } from '@hono/zod-openapi';
import type { AppDeps } from '../env.ts';
import { newRouter } from '../http/router.ts';

/** The API contract version; bumped only on a breaking change to `/api`. */
export const API_VERSION = 1;

const VersionSchema = z
  .object({
    version: z.string().openapi({ example: '0.0.0' }),
    apiVersion: z.literal(API_VERSION),
  })
  .openapi('Version');

const versionRoute = createRoute({
  method: 'get',
  path: '/api/version',
  tags: ['meta'],
  summary: 'The server version and the API contract version',
  responses: {
    200: { description: 'Versions', content: { 'application/json': { schema: VersionSchema } } },
  },
});

export function metaRoutes(deps: AppDeps) {
  return newRouter().openapi(versionRoute, (c) =>
    c.json({ version: deps.version, apiVersion: API_VERSION }, 200),
  );
}
