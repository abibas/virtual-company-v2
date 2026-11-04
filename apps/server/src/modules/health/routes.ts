import { createRoute } from '@hono/zod-openapi';
import type { AppDeps } from '../../platform/env.ts';
import { newRouter } from '../../platform/http/router.ts';
import {
  API_VERSION,
  HealthSchema,
  NotReadySchema,
  PublicConfigSchema,
  ReadySchema,
  VersionSchema,
} from './schemas.ts';
import { healthService, publicConfig } from './service.ts';

const healthzRoute = createRoute({
  method: 'get',
  path: '/healthz',
  tags: ['health'],
  summary: 'Liveness: the process is up (never touches the database)',
  responses: {
    200: { description: 'Alive', content: { 'application/json': { schema: HealthSchema } } },
  },
});

const readyzRoute = createRoute({
  method: 'get',
  path: '/readyz',
  tags: ['health'],
  summary:
    'Readiness: the database answers and every migration is applied (with the jobs loop, for information)',
  responses: {
    200: { description: 'Ready', content: { 'application/json': { schema: ReadySchema } } },
    503: { description: 'Not ready', content: { 'application/json': { schema: NotReadySchema } } },
  },
});

const versionRoute = createRoute({
  method: 'get',
  path: '/api/version',
  tags: ['meta'],
  summary: 'The server version and the API contract version',
  responses: {
    200: { description: 'Versions', content: { 'application/json': { schema: VersionSchema } } },
  },
});

const configRoute = createRoute({
  method: 'get',
  path: '/api/config',
  tags: ['meta'],
  summary: 'The public configuration the web reads when it boots: how people sign in, and where',
  description:
    "No credential needed, and never a secret: the sign-in mode, Clerk's publishable key when Clerk signs people " +
    'in, the web origin and the public URL of the API. Read at run time, so one image works in any environment.',
  responses: {
    200: {
      description: 'The public configuration',
      content: { 'application/json': { schema: PublicConfigSchema } },
    },
  },
});

/**
 * Liveness (`/healthz`), readiness (`/readyz`), the versions (`/api/version`) and the public configuration
 * (`/api/config`).
 */
export function healthRoutes(deps: AppDeps) {
  const health = healthService(deps);
  const config = publicConfig(deps.config);
  return newRouter()
    .openapi(healthzRoute, (c) => c.json({ status: 'ok' as const, version: deps.version }, 200))
    .openapi(readyzRoute, async (c) => {
      const check = await health.readiness();
      if (!check.ready) {
        return c.json({ status: 'not_ready' as const, reason: check.reason }, 503);
      }
      const { applied, expected, last } = check.migrations;
      const { lastTickAt, ...jobs } = await health.jobs(c.var.clock());
      return c.json(
        {
          status: 'ready' as const,
          version: deps.version,
          db: 'ok' as const,
          migrations: { applied, expected, last },
          jobs: { ...jobs, lastTickAt: lastTickAt?.toISOString() ?? null },
        },
        200,
      );
    })
    .openapi(versionRoute, (c) => c.json({ version: deps.version, apiVersion: API_VERSION }, 200))
    .openapi(configRoute, (c) => {
      // Computed once per app; no-store so a restart with new settings shows at once.
      c.header('cache-control', 'no-store');
      return c.json(config, 200);
    });
}
