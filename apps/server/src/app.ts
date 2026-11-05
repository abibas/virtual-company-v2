import { OpenAPIHono } from '@hono/zod-openapi';
import { newId } from '@mwc/shared/ids';
import { requestId } from 'hono/request-id';
import { apiKeysRoutes } from './modules/api-keys/index.ts';
import { companiesRoutes, companyOutboxHandlers } from './modules/companies/index.ts';
import { healthRoutes } from './modules/health/index.ts';
import { identityRoutes, reconcileCompany, retryIdentityEvents } from './modules/identity/index.ts';
import { invitationOutboxHandlers, memberOutboxHandlers, membersRoutes } from './modules/members/index.ts';
import { orgRoutes } from './modules/org/index.ts';
import type { AppDeps, AppEnv, ServerDeps } from './platform/env.ts';
import { mountDocs } from './platform/http/docs.ts';
import { errorHandler, notFoundHandler, validationHook } from './platform/http/errors.ts';
import { requestLog } from './platform/http/request-log.ts';
import { mountWeb } from './platform/http/web.ts';
import { identityFromConfig } from './platform/identity.ts';
import { outboxRegistry } from './platform/jobs/outbox-drain.ts';
import type { ModuleJobs } from './platform/jobs/run.ts';

export type { AppDeps, AppEnv, ServerDeps } from './platform/env.ts';

/** An incoming `x-request-id` is kept when it is at most this long and only `[A-Za-z0-9_=-]`. */
export const REQUEST_ID_MAX_LENGTH = 128;

/**
 * The API as a Hono app: the platform (request ids, the clock, the request log, errors, API docs, the
 * built UI) around the modules, with everything it needs passed in, so tests drive it through
 * `app.request()` on PGlite and `platform/start.ts` serves it on Postgres. Each module is a router from
 * `newRouter()`, exported by `modules/<area>/index.ts` and mounted here. The identity provider is the one
 * passed in (tests: the fake), else the one the configuration names (`platform/identity.ts`: the Clerk
 * connector, or none).
 */
export function createApp(deps: AppDeps) {
  const clock = deps.clock ?? (() => new Date());
  const server: ServerDeps = { ...deps, clock, identity: deps.identity ?? identityFromConfig(deps.config) };
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });

  app.use(requestId({ limitLength: REQUEST_ID_MAX_LENGTH, generator: () => newId() }));
  app.use(async (c, next) => {
    c.set('clock', clock);
    await next();
  });
  app.use(requestLog(deps.logger));
  app.onError(errorHandler(deps.logger));
  app.notFound(notFoundHandler);

  const routes = app
    .route('/', healthRoutes(deps))
    .route('/', identityRoutes(server))
    .route('/', companiesRoutes(server))
    .route('/', membersRoutes(server))
    .route('/', apiKeysRoutes(server))
    .route('/', orgRoutes(server));
  mountDocs(app, deps);
  // Last: the UI only answers what no API route did.
  if (deps.webDist) mountWeb(app, deps.webDist, deps.logger);
  return routes;
}

/** The app's type, for the web's typed client: `hc<AppType>(baseUrl)` (a type-only import). */
export type AppType = ReturnType<typeof createApp>;

/**
 * What the jobs loop (`platform/jobs/`, started by `platform/start.ts`) runs from the modules: their outbox handlers
 * in one registry (companies: create_org, delete_org; members: update_role, remove_member; invitations: invite,
 * revoke_invite), the retry of webhook events and the company reconcile (identity). The modules export them and only
 * this file composes them, so no module imports the loop and the loop imports no module.
 */
export function moduleJobs(deps: ServerDeps): ModuleJobs {
  return {
    outboxHandlers: outboxRegistry(
      companyOutboxHandlers(deps),
      memberOutboxHandlers(deps),
      invitationOutboxHandlers(deps),
    ),
    retryEvents: () => retryIdentityEvents(deps),
    reconcileCompany: (companyId) => reconcileCompany(deps, companyId),
  };
}
