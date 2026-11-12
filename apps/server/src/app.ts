import { OpenAPIHono } from '@hono/zod-openapi';
import { newId } from '@mwc/shared/ids';
import { requestId } from 'hono/request-id';
import { apiKeysRoutes } from './modules/api-keys/index.ts';
import { chatsRoutes, chatsRuntime, reapTurns as reapChatTurns } from './modules/chats/index.ts';
import { companiesRoutes, companyOutboxHandlers } from './modules/companies/index.ts';
import {
  credentialsRoutes,
  providerFetchFor,
  signInRoutes,
  toolCheckJob,
} from './modules/credentials/index.ts';
import { healthRoutes } from './modules/health/index.ts';
import { identityRoutes, reconcileCompany, retryIdentityEvents } from './modules/identity/index.ts';
import { inboxRoutes } from './modules/inbox/index.ts';
import {
  createPowerControl,
  createRunnerHub,
  machinePowerRuntime,
  machinesRoutes,
  machineUpkeep,
  type PowerControl,
  type RunnerHub,
  terminalTickets,
} from './modules/machines/index.ts';
import { invitationOutboxHandlers, memberOutboxHandlers, membersRoutes } from './modules/members/index.ts';
import { deliverEmails, membershipNoticeHook, notificationsRoutes } from './modules/notifications/index.ts';
import { memberChart, orgRoutes } from './modules/org/index.ts';
import { speechRoutes } from './modules/speech/index.ts';
import { leadWakes, tasksRoutes, taskTurnHook } from './modules/tasks/index.ts';
import { emailFromConfig } from './platform/email/select.ts';
import type { AppDeps, AppEnv, ServerDeps } from './platform/env.ts';
import { mountDocs } from './platform/http/docs.ts';
import { errorHandler, notFoundHandler, validationHook } from './platform/http/errors.ts';
import { requestLog } from './platform/http/request-log.ts';
import { mountWeb } from './platform/http/web.ts';
import { identityFromConfig } from './platform/identity.ts';
import { outboxRegistry } from './platform/jobs/outbox-drain.ts';
import type { ModuleJobs } from './platform/jobs/run.ts';
import { SYSTEM_TIMERS } from './platform/jobs/runner.ts';
import { localDockerFromConfig } from './platform/processes/docker/local.ts';
import { loginHelperFromConfig } from './platform/processes/login-helper/select.ts';
import type { LocalPower } from './platform/processes/power/local.ts';
import { speechFromConfig } from './platform/processes/speech/select.ts';
import { ephemeralKeyring } from './platform/secrets/keyring.ts';
import { envKeyring } from './platform/secrets/master-key.ts';

export {
  createPowerControl,
  createRunnerHub,
  type PowerControl,
  type RunnerHub,
} from './modules/machines/index.ts';
export type { AppDeps, AppEnv, ServerDeps } from './platform/env.ts';

/** What `createApp` takes: the app's deps and, from the composition that shares them, the module objects it mounts. */
export interface AppOptions extends AppDeps {
  /**
   * The runner hub (the machines module): every runner socket of this process, by machine. Omitted, the app makes its
   * own and closes it on shutdown (`onShutdown`).
   */
  readonly runnerHub?: RunnerHub;
  /**
   * Who drives the devboxes (the machines module): this server with its own driver (`platform/start.ts` builds it from
   * MWC_LOCAL_POWER's `LocalPower`), else their runner controllers. Omitted, the runner controllers' on the app's hub.
   */
  readonly powerControl?: PowerControl;
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
 * the runners' sockets (`platform/realtime/sockets.ts`, whose server `start.ts` gives to `serve()`). The power control
 * is the one passed in (`start.ts`: this server's own driver when MWC_LOCAL_POWER finds the airia CLI), else the runner
 * controllers'; `/api/config` says which (`localPower`). The chats (S5.1b) start their turns through the same hub and
 * share the machines' terminal tickets and wake a stopped machine through the machines' power runtime (a message, a
 * step's run, a Lead's wake-up); the tasks (S5.3b) run their steps through the chats' runtime, whose task
 * conversations report back to the tasks module's hook, and (S6c) wake their agent Leads in its team chats.
 * Dictation transcribes through the speech passed in (tests: a fake; undefined: off), else this computer's whisper.cpp
 * when MWC_WHISPER finds it, stopped on shutdown; `/api/config` says so (`speech`).
 * Container runners are rebuilt with the Docker CLI passed in (tests: a fake; undefined: none), else the one
 * MWC_LOCAL_DOCKER finds.
 */
export function createApp(deps: AppOptions) {
  const clock = deps.clock ?? (() => new Date());
  const server: ServerDeps = { ...deps, clock, identity: deps.identity ?? identityFromConfig(deps.config) };
  const withChart = withMemberChart(server);
  const keyring = deps.keyring ?? envKeyring(deps.config) ?? ephemeralKeyring();
  const loginHelper =
    'loginHelper' in deps ? deps.loginHelper : loginHelperFromConfig(deps.config, deps.logger);
  const speech = 'speech' in deps ? deps.speech : speechFromConfig(deps.config, deps.logger);
  const localDocker =
    'localDocker' in deps ? deps.localDocker : localDockerFromConfig(deps.config, deps.logger);
  if (speech) server.onShutdown?.(() => speech.close());
  const hub = deps.runnerHub ?? ownHub(server);
  const control =
    deps.powerControl ?? createPowerControl({ hub, port: deps.config.MWC_PORT, logger: deps.logger });
  // One ticket store for the machines' terminals and the chats' (S5.1b): both open the same browser socket.
  const tickets = terminalTickets();
  // One power runtime: the machines' routes and the chats' wakes of a stopped machine share its locks and its starts.
  const power = machinePowerRuntime({ ...server, localDocker, hub, control });
  // One chats runtime (S5.3b): the chats' routes and the tasks module's step runs share its live turns and queue, and a
  // task's conversation reports its turns to the tasks module's hook. Neither module imports the other. The hook runs
  // the next step after an agent's decision or a Lead's move (S6a) through the runtime, asked when needed.
  const hook = taskTurnHook({ ...server, steps: () => chats.taskTurns });
  const chatsDeps = { ...server, hub, tickets, keyring, tasks: hook, wake: power.wake };
  const chats = chatsRuntime(chatsDeps);
  startLeadWakes(server, chats.teamChats, deps.leadWakeTimers);
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
    .route(
      '/',
      healthRoutes({ ...deps, localPower: control.kind === 'server', dictation: speech !== undefined }),
    )
    .route('/', identityRoutes(withChart))
    .route('/', companiesRoutes(server))
    .route('/', membersRoutes(withChart))
    .route('/', apiKeysRoutes(server))
    .route('/', orgRoutes(server))
    .route('/', credentialsRoutes({ ...server, keyring }))
    .route('/', signInRoutes({ ...server, keyring, loginHelper }))
    .route('/', machinesRoutes({ ...server, hub, control, tickets, localDocker, power }))
    .route('/', chatsRoutes(chatsDeps, chats))
    .route('/', speechRoutes({ ...server, speech }))
    .route('/', notificationsRoutes(server))
    .route('/', tasksRoutes({ ...server, steps: chats.taskTurns, team: chats.teamChats }))
    .route('/', inboxRoutes(server));
  mountDocs(app, deps);
  // Last: the UI only answers what no API route did.
  if (deps.webDist) mountWeb(app, deps.webDist, deps.logger);
  return routes;
}

/**
 * The tick that wakes flows' agent Leads in their team chats (S6c), in this process since it holds the runners' sockets
 * and the chats' live turns: started when the server runs its background work (MWC_JOBS) or a test passes its timers,
 * stopped with the server.
 */
function startLeadWakes(
  server: ServerDeps,
  chats: ReturnType<typeof chatsRuntime>['teamChats'],
  timers: AppDeps['leadWakeTimers'],
) {
  if (!server.config.MWC_JOBS && timers === undefined) return;
  const wakes = leadWakes({ ...server, chats, timers: timers ?? SYSTEM_TIMERS });
  wakes.start();
  server.onShutdown?.(() => wakes.stop());
}

/** A hub of the app's own, closed with the server (its sockets told the server is going away, their writes done). */
function ownHub(server: ServerDeps): RunnerHub {
  const hub = createRunnerHub(server, { turnGraceMs: server.config.MWC_TURN_GRACE_SECONDS * 1000 });
  server.onShutdown?.(() => hub.close());
  return hub;
}

/**
 * The machines module's share of a server process, for the app and the jobs loop to share (`platform/start.ts`): one
 * runner hub and one power control (this server's own driver when MWC_LOCAL_POWER found one, holding the devboxes'
 * tunnels), both closed with the server.
 */
export function machinesRuntime(server: ServerDeps, local: LocalPower | undefined) {
  const runnerHub = ownHub(server);
  const powerControl = createPowerControl({
    hub: runnerHub,
    port: server.config.MWC_PORT,
    logger: server.logger,
    local,
  });
  server.onShutdown?.(() => powerControl.close());
  return { runnerHub, powerControl };
}

/**
 * At the server's start, before it listens: the chat turns a stopped server left waiting where nothing runs fail
 * (`server_restarted`), and a task whose step's turn was one of them is blocked through the tasks module's hook
 * (S5.3b); running turns wait for their runners (S5.4, the chats runtime). Returns how many failed.
 */
export const reapTurns = (deps: Pick<ServerDeps, 'db' | 'logger'> & { readonly clock: () => Date }) =>
  reapChatTurns({ ...deps, tasks: taskTurnHook(deps) });

/** The app's type, for the web's typed client: `hc<AppType>(baseUrl)` (a type-only import). */
export type AppType = ReturnType<typeof createApp>;

/**
 * The deps with the org module's side of a membership's start and end (`memberChart`), for the identity and members
 * modules, whose paths start and end memberships: composed here, so neither of them imports the org module, which
 * reads people's profiles through the identity module (S2.4). The notifications module's side of a membership's change
 * (`membershipNoticeHook`, S2.9) rides along, so the identity store tells the person, or their inviter, by the same port.
 */
export function withMemberChart(deps: ServerDeps) {
  return { ...deps, chart: { ...memberChart(deps), ...membershipNoticeHook } };
}

/**
 * What the jobs loop (`platform/jobs/`, started by `platform/start.ts`) runs from the modules: the machines' upkeep
 * (the offline sweep, the hourly prune of samples and, with the app's runner hub and power control, the power
 * scheduler), their outbox handlers in one registry (companies: create_org,
 * delete_org; members: update_role, remove_member; invitations: invite, revoke_invite), the retry of webhook events and
 * the company reconcile (identity), both with the org chart a membership that starts or ends moves its person on, and
 * the notification emails (S2.9) through the sender passed in (tests) or the one MWC_EMAIL names, and the tool sign-ins'
 * daily check (S7.1a) with the keyring passed in (`platform/start.ts`: the app's) and the provider client. The modules
 * export them and only this file composes them, so no
 * module imports the loop and the loop imports no module.
 */
export function moduleJobs(
  deps: ServerDeps & { readonly hub?: RunnerHub; readonly control?: PowerControl },
): ModuleJobs {
  const identity = withMemberChart(deps);
  const email =
    'email' in deps ? deps.email : emailFromConfig(deps.config, deps.logger, { clock: deps.clock });
  const keyring = deps.keyring ?? envKeyring(deps.config) ?? ephemeralKeyring();
  const providerFetch = deps.providerFetch ?? providerFetchFor(deps.config);
  return {
    machines: machineUpkeep(deps),
    toolChecks: toolCheckJob({ ...deps, keyring, providerFetch }),
    outboxHandlers: outboxRegistry(
      companyOutboxHandlers(deps),
      memberOutboxHandlers(deps),
      invitationOutboxHandlers(deps),
    ),
    notifications: () => deliverEmails({ ...deps, email }),
    retryEvents: () => retryIdentityEvents(identity),
    reconcileCompany: (companyId) => reconcileCompany(identity, companyId),
  };
}
