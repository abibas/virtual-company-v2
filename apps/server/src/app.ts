import { OpenAPIHono } from '@hono/zod-openapi';
import { newId } from '@mwc/shared/ids';
import { requestId } from 'hono/request-id';
import { apiKeysRoutes } from './modules/api-keys/index.ts';
import { companiesRoutes, companyOutboxHandlers } from './modules/companies/index.ts';
import { credentialsRoutes, signInRoutes } from './modules/credentials/index.ts';
import { healthRoutes } from './modules/health/index.ts';
import { identityRoutes, reconcileCompany, retryIdentityEvents } from './modules/identity/index.ts';
import { createRunnerHub, machinesRoutes, machineUpkeep, type RunnerHub } from './modules/machines/index.ts';
import { invitationOutboxHandlers, memberOutboxHandlers, membersRoutes } from './modules/members/index.ts';
import { memberChart, orgRoutes } from './modules/org/index.ts';
import type { AppDeps, AppEnv, ServerDeps } from './platform/env.ts';
import { mountDocs } from './platform/http/docs.ts';
import { errorHandler, notFoundHandler, validationHook } from './platform/http/errors.ts';
import { requestLog } from './platform/http/request-log.ts';
import { mountWeb } from './platform/http/web.ts';
import { identityFromConfig } from './platform/identity.ts';
import { outboxRegistry } from './platform/jobs/outbox-drain.ts';
import type { ModuleJobs } from './platform/jobs/run.ts';
import { loginHelperFromConfig } from './platform/login-helper/select.ts';
import { ephemeralKeyring } from './platform/secrets/keyring.ts';
import { envKeyring } from './platform/secrets/master-key.ts';

export { createRunnerHub, type RunnerHub } from './modules/machines/index.ts';
export type { AppDeps, AppEnv, ServerDeps } from './platform/env.ts';

/** What `createApp` takes: the app's deps and, from the composition that shares them, the module objects it mounts. */
export interface AppOptions extends AppDeps {
  /**
   * The runner hub (the machines module): every runner socket of this process, by machine. Omitted, the app makes its
   * own and closes it on shutdown (`onShutdown`).
   */
  readonly runnerHub?: RunnerHub;
}

/** An incoming `x-request-id` is kept when it is at most this long and only `[A-Za-z0-9_=-]`. */
export const REQUEST_ID_MAX_LENGTH = 128;

/**
 * The API as a Hono app: the platform (request ids, the clock, the request log, errors, API docs, the
 * built UI) around the modules, with everything it needs passed in, so tests drive it through
 * `app.request()` on PGlite and `platform/start.ts` serves it on Postgres. Each module is a router from
 * `newRouter()`, exported by `modules/<area>/index.ts` and mounted here. The identity provider is the one
 * passed in (tests: the fake), else the one the configuration names (`platform/identity.ts`: the Clerk
 * connector, or none). The master keyring is the one passed in (`platform/start.ts` loads it), else MWC_MASTER_KEY's,
 * else a key in memory (tests and demos). The sign-in helper is the one passed in (tests: a fake; undefined: none),
 * else the one MWC_LOGIN_HELPER names. The runner hub is the one passed in, else one of its own; the HTTP server hands it
 * the runners' sockets (`platform/realtime/sockets.ts`, whose server `start.ts` gives to `serve()`).
 */
export function createApp(deps: AppOptions) {
  const clock = deps.clock ?? (() => new Date());
  const server: ServerDeps = { ...deps, clock, identity: deps.identity ?? identityFromConfig(deps.config) };
  const withChart = withMemberChart(server);
  const keyring = deps.keyring ?? envKeyring(deps.config) ?? ephemeralKeyring();
  const loginHelper =
    'loginHelper' in deps ? deps.loginHelper : loginHelperFromConfig(deps.config, deps.logger);
  const hub = deps.runnerHub ?? ownHub(server);
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
    .route('/', identityRoutes(withChart))
    .route('/', companiesRoutes(server))
    .route('/', membersRoutes(withChart))
    .route('/', apiKeysRoutes(server))
    .route('/', orgRoutes(server))
    .route('/', credentialsRoutes({ ...server, keyring }))
    .route('/', signInRoutes({ ...server, keyring, loginHelper }))
    .route('/', machinesRoutes({ ...server, hub }));
  mountDocs(app, deps);
  // Last: the UI only answers what no API route did.
  if (deps.webDist) mountWeb(app, deps.webDist, deps.logger);
  return routes;
}

/** A hub of the app's own, closed with the server (its sockets told the server is going away, their writes done). */
function ownHub(server: ServerDeps): RunnerHub {
  const hub = createRunnerHub(server);
  server.onShutdown?.(() => hub.close());
  return hub;
}

/** The app's type, for the web's typed client: `hc<AppType>(baseUrl)` (a type-only import). */
export type AppType = ReturnType<typeof createApp>;

/**
 * The deps with the org module's side of a membership's start and end (`memberChart`), for the identity and members
 * modules, whose paths start and end memberships: composed here, so neither of them imports the org module, which
 * reads people's profiles through the identity module (S2.4).
 */
export function withMemberChart(deps: ServerDeps) {
  return { ...deps, chart: memberChart(deps) };
}

/**
 * What the jobs loop (`platform/jobs/`, started by `platform/start.ts`) runs from the modules: the machines' upkeep
 * (the offline sweep, the hourly prune of samples and, with the app's runner hub, the power scheduler), their outbox
 * handlers in one registry (companies: create_org,
 * delete_org; members: update_role, remove_member; invitations: invite, revoke_invite), the retry of webhook events and
 * the company reconcile (identity), both with the org chart a membership that starts or ends moves its person on. The modules export them and only this file composes them, so no
 * module imports the loop and the loop imports no module.
 */
export function moduleJobs(deps: ServerDeps & { readonly hub?: RunnerHub }): ModuleJobs {
  const identity = withMemberChart(deps);
  return {
    machines: machineUpkeep(deps),
    outboxHandlers: outboxRegistry(
      companyOutboxHandlers(deps),
      memberOutboxHandlers(deps),
      invitationOutboxHandlers(deps),
    ),
    retryEvents: () => retryIdentityEvents(identity),
    reconcileCompany: (companyId) => reconcileCompany(identity, companyId),
  };
}
