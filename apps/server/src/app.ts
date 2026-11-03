import { OpenAPIHono } from '@hono/zod-openapi';
import { newId } from '@mwc/shared/ids';
import { requestId } from 'hono/request-id';
import type { AppDeps, AppEnv } from './env.ts';
import { errorHandler, notFoundHandler, validationHook } from './http/errors.ts';
import { requestLog } from './http/request-log.ts';
import { mountDocs } from './routes/docs.ts';
import { healthRoutes } from './routes/health.ts';
import { metaRoutes } from './routes/meta.ts';
import { mountWeb } from './routes/web.ts';

export type { AppDeps, AppEnv } from './env.ts';

/** An incoming `x-request-id` is kept when it is at most this long and only `[A-Za-z0-9_=-]`. */
export const REQUEST_ID_MAX_LENGTH = 128;

/**
 * The API as a Hono app, with everything it needs passed in, so tests drive it through
 * `app.request()` on PGlite and `main.ts` serves it on Postgres.
 */
export function createApp(deps: AppDeps) {
  const clock = deps.clock ?? (() => new Date());
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });

  app.use(requestId({ limitLength: REQUEST_ID_MAX_LENGTH, generator: () => newId() }));
  app.use(async (c, next) => {
    c.set('clock', clock);
    await next();
  });
  app.use(requestLog(deps.logger));
  app.onError(errorHandler(deps.logger));
  app.notFound(notFoundHandler);

  const routes = app.route('/', healthRoutes(deps)).route('/', metaRoutes(deps));
  mountDocs(app, deps);
  // Last: the UI only answers what no API route did.
  if (deps.webDist) mountWeb(app, deps.webDist, deps.logger);
  return routes;
}

/** The app's type, for the web's typed client: `hc<AppType>(baseUrl)` (a type-only import). */
export type AppType = ReturnType<typeof createApp>;
