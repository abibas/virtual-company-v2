# Testing

Every change ships with tests and `pnpm mwc check` green before it is committed. Tests live in each
package's `test/`, mirroring `src/` (`src/a/b.ts` → `test/a/b.test.ts`, shared helpers in
`test/fixtures/`; `docs/structure.md`). There are no frontend tests for now (Ihor, 2026-11-04: no UI
unit tests and no browser smoke); the web is typechecked in every lane and built in `--full`.

## Lanes

| Lane | Command | What runs | When |
| --- | --- | --- | --- |
| fast | `pnpm mwc check --fast` | Biome, banned names, `tsc --noEmit` per workspace package (`packages/*`, `connectors/*`, `apps/*`), db drift (migrations and `docs/schema.md`), all Vitest tests on PGlite, no coverage | the git pre-push hook |
| default | `pnpm mwc check` | the fast lane with coverage (v8; overall 90% lines/statements/functions and 85% branches, every file 85% lines and 75% branches; reports in `.cache/coverage/`) | before every commit |
| full | `pnpm mwc check --full` | the default lane, then the tests again on the dev Postgres and the web build | before a push that touches the database, the server or the web, and at the end of a stage |

**Banned names** (in every lane, in-process, one `git ls-files`): every file git tracks or would track
(untracked files that are not ignored count too), except `pnpm-lock.yaml` and binary files, is scanned
case-insensitively for the terms in `packages/cli/src/banned.ts`, names from earlier versions of the
product that never appear in this repository; a hit fails the check with `file:line`. The terms are built
from parts in that file, so the list never contains them. The `commit-msg` hook
(`.githooks/commit-msg`, `mwc banned --message <file>`) applies the same list to each commit message
(without git's `#` comment lines and the `git commit -v` diff). `pnpm mwc banned` runs the file scan alone.

`--full` in order:

1. `postgres` starts the dev Postgres (`deploy/compose.yml`, 127.0.0.1:9952) and waits for its
   healthcheck, unless it is already running (then it is left as it is, e.g. under `pnpm dev`).
   Without Docker the Postgres steps are skipped and the check says so.
2. `tests on postgres` runs Vitest with `TEST_DB=postgres` and
   `TEST_DATABASE_URL=postgres://mwc:mwc@localhost:9952/mwc`, with coverage in `.cache/coverage/postgres/`.
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
   touched. The sweep runs against the real server in this lane only (`packages/db/test/testing.test.ts`);
   its code paths also run in every lane against a fake server (`createTestDb(env, server)`).
3. `web build`: `vite build` of `apps/web` into `apps/web/dist`.
4. `postgres down` stops the dev Postgres again if step 1 started it (the volume stays).

## Where the tests are

| Package | Tests | Database |
| --- | --- | --- |
| `packages/shared` | config, ports, ids, enums, the identity contracts (unit) | none |
| `packages/identity-core` | the fake provider (tokens, CRUD and errors, events, `failNext`, webhooks), the projector rule by rule, convergence (200 seeded shuffles, double deliveries, every order of one person's history), reconcile against the webhook path, the in-memory store | none (`InMemoryIdentityStore`) |
| `packages/cli` | argument parsing, `mwc check` and `mwc dev` plans with fake processes, package discovery, the banned-names scanner and the commit-msg hook's command, two short real-process checks of the spawn wrapper | none |
| `packages/db` | schema constraints, migrations, `migrationStatus`, `queryRows`, the schema diagram, test database names, the Postgres paths of `createTestDb` against a fake server, and the stale-database sweep | `createTestDb()`: PGlite, or Postgres with `TEST_DB=postgres` |
| `packages/testkit` | its own helpers (capture logger, fixed clock, JSON requests, `createTestApp`, the identity re-exports), and a guard that the workspace's dependency graph has no cycle except the dev-only testkit ↔ server one | `createTestApp()` |
| `apps/server` | mirrors `src/`: the app's wiring (request ids, clock), `platform/http` through `app.request()` (request log, errors, OpenAPI and docs, static UI), `platform/` (logger, graceful shutdown, version, `start` with injected database, server and signals, plus one real `serve()` on a free port), `modules/health` (`/healthz`, `/readyz`, `/api/version`), `dev/memory-server` | `createTestApp()` on `createTestDb()`; `start` on PGlite |
| `apps/web` | none for now | — |

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
| `FakeIdentityProvider`, `InMemoryIdentityStore` | the in-memory identity provider (`fake:<subject>[;org=<id>][;pending]` tokens, `accept()`, `drainEvents()`, `failNext()`, `webhookFor()`) and identity store, from `@mwc/identity-core` (its README) |

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
on every install, and `packages/testkit/test/workspace.test.ts` fails on any other cycle or if the testkit
ever becomes a production dependency. S1.1 added `FakeIdentityProvider` and `InMemoryIdentityStore` here;
`signedWebhook` (S1.2) and `seedCompany` (S1.3) follow.

## Running one piece

```sh
pnpm exec vitest run --project server                 # one package's tests on PGlite (also: testkit, db, ...)
pnpm exec vitest run apps/server/test/modules/health/routes.test.ts   # one file
pnpm mwc dev                                          # or just the dev Postgres: docker compose -f deploy/compose.yml up -d --wait postgres
TEST_DB=postgres TEST_DATABASE_URL=postgres://mwc:mwc@localhost:9952/mwc pnpm exec vitest run
```

Keep tests cheap to run: the Mac bills every process start, so tests drive code in-process
(`app.request()`, injected spawn/exec fakes) and start real processes only where the process itself is
what is being tested.
