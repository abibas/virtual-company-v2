# Testing

Every change ships with tests and `pnpm mwc check` green before it is committed. There are no UI unit
tests (house rule); the web is covered by a Playwright smoke.

## Lanes

| Lane | Command | What runs | When |
| --- | --- | --- | --- |
| fast | `pnpm mwc check --fast` | Biome, `tsc --noEmit` per package (cli, db, shared, testkit, server, web), db drift (migrations and `docs/schema.md`), all Vitest tests on PGlite, no coverage | the git pre-push hook |
| default | `pnpm mwc check` | the fast lane with coverage (v8, thresholds 80% lines/statements/functions, 70% branches; report in `coverage/`) | before every commit |
| full | `pnpm mwc check --full` | the default lane, then the tests again on the dev Postgres, the web build and the Playwright smoke | before a push that touches the database, the server or the web, and at the end of a stage |

`--full` in order:

1. `postgres` starts the dev Postgres (`deploy/compose.yml`, 127.0.0.1:9952) and waits for its
   healthcheck, unless it is already running (then it is left as it is, e.g. under `pnpm dev`).
   Without Docker the Postgres steps are skipped and the check says so.
2. `tests on postgres` runs Vitest with `TEST_DB=postgres` and
   `TEST_DATABASE_URL=postgres://mwc:mwc@localhost:9952/mwc`, with coverage in `coverage/postgres/`.
   Each db and server test database is then a new database `mwc_test_<time>_<random>` on that
   server, reached through `createDb` (postgres.js) and dropped when the test closes it
   (`@mwc/db/testing`), so the postgres.js paths of `createDb`, `migrateToLatest`, `migrationStatus`
   and `queryRows` run against a real Postgres 17 and the dev database `mwc` is never touched. All
   projects run (Vitest 5 reports no coverage when `--project` filters them); the cli and shared tests
   ignore `TEST_DB`.
   **Leftovers:** a run that is killed (Ctrl-C, a crash) cannot drop its databases, so the first
   `createTestDb()` of every test process sweeps first (`dropStaleTestDbs`): it drops the `mwc_test_*`
   databases whose name says they are older than 1 hour (`<time>` is the creation time in ms, base 36)
   and that have no connection. The drop runs without `FORCE`, so a database somebody connects to in the
   meantime is refused by Postgres and kept; names that do not have the test-database shape are never
   touched. The sweep's own tests run in this lane only (`packages/db/src/testing.test.ts`).
3. `web build`: `vite build` of `apps/web` into `apps/web/dist`.
4. `e2e`: Playwright (`apps/web/playwright.config.ts`) starts the API on an in-memory PGlite
   (`apps/server/src/dev-memory.ts`, 127.0.0.1:9957) and `vite preview` of the build (127.0.0.1:9955),
   then runs `apps/web/e2e/*.spec.ts` in the installed Google Chrome (`channel: 'chrome'`; no browser
   is downloaded). Results and traces of failures go to `.data/playwright/`.
5. `postgres down` stops the dev Postgres again if step 1 started it (the volume stays).

## Where the tests are

| Package | Tests | Database |
| --- | --- | --- |
| `packages/shared` | config, ports, ids, enums (unit) | none |
| `packages/cli` | argument parsing, `mwc check` and `mwc dev` plans with fake processes, two short real-process checks of the spawn wrapper | none |
| `packages/db` | schema constraints, migrations, `migrationStatus`, `queryRows`, the schema diagram, test database names and the stale-database sweep | `createTestDb()`: PGlite, or Postgres with `TEST_DB=postgres` |
| `packages/testkit` | its own helpers (capture logger, fixed clock, JSON requests, `createTestApp`), and a guard that the workspace's dependency graph has no cycle except the dev-only testkit ↔ server one | `createTestApp()` |
| `apps/server` | the API through `app.request()` (health, readiness, errors, request ids, OpenAPI, docs, static UI), the logger, graceful shutdown, one real `serve()` on an ephemeral port | `createTestApp()` on `createTestDb()` |
| `apps/web` | `e2e/shell.spec.ts` (the shell and "API v… · ready"), `e2e/bundle.spec.ts` (no server code in the bundle) | the in-memory API |

## The test kit (`@mwc/testkit`)

One import for what tests need; add `"@mwc/testkit": "workspace:*"` to the package's `devDependencies`.

| Helper | What |
| --- | --- |
| `createTestApp(options?)` | `{ app, db, logger, logs, close }`: `createApp` of `@mwc/server` on a fresh test database, migrated, with a silent capture logger (`logs` holds every line, parsed), `TEST_VERSION` and `testConfig`. Options are anything `createApp` takes (`db`, `clock`, `webDist`, `journal`, `logger`) plus `migrate: false`; a `db` passed in is used as is and not closed. |
| `createTestDb()`, `testDbKind()`, `pgError(query)` | test databases (PGlite, or Postgres with `TEST_DB=postgres`) and the SQLSTATE/constraint behind a rejected query; the implementation lives in `@mwc/db/testing`, which the db package's own tests import directly |
| `fixedClock(at = TEST_NOW)` | a `() => Date` that stands still until `clock.advance(ms)` or `clock.set(at)`; pass it as `createTestApp({ clock })` |
| `getJson(app, path, headers?)`, `postJson(app, path, body, headers?)`, `requestJson(app, method, path, { body, headers })` | one in-process request, returning `{ status, body, headers }` with the body parsed |
| `captureLogger()`, `LEVEL` | a pino logger that keeps its lines in an array, and pino's numeric levels |
| `brokenDb('reject' \| 'hang')` | a handle whose queries fail or never answer, as if Postgres were down |

```ts
import { createTestApp, fixedClock, getJson, type TestApp } from '@mwc/testkit';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ clock: fixedClock() });
});
afterAll(() => t.close());

it('is ready', async () => {
  expect(await getJson(t.app, '/readyz')).toMatchObject({ status: 200, body: { status: 'ready' } });
});
```

The testkit depends on `@mwc/server` and the server's tests use the testkit: a dev-only cycle, harmless
without build steps. `pnpm-workspace.yaml` sets `ignoreWorkspaceCycles` so pnpm does not warn about it
on every install, and `packages/testkit/src/workspace.test.ts` fails on any other cycle or if the testkit
ever becomes a production dependency. S1 adds `FakeIdentityProvider` (S1.1), `signedWebhook` (S1.2) and
`seedCompany` (S1.3) here.

## Running one piece

```sh
pnpm exec vitest run --project server                 # one package's tests on PGlite (also: testkit, db, ...)
pnpm exec vitest run apps/server/src/health.test.ts   # one file
pnpm mwc dev                                          # or just the dev Postgres: docker compose -f deploy/compose.yml up -d --wait postgres
TEST_DB=postgres TEST_DATABASE_URL=postgres://mwc:mwc@localhost:9952/mwc pnpm exec vitest run
pnpm e2e                                              # web build + Playwright smoke
```

Keep tests cheap to run: the Mac bills every process start, so tests drive code in-process
(`app.request()`, injected spawn/exec fakes) and start real processes only where the process itself is
what is being tested.
