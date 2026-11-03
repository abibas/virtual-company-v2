# Testing

Every change ships with tests and `pnpm mwc check` green before it is committed. There are no UI unit
tests (house rule); the web is covered by a Playwright smoke.

## Lanes

| Lane | Command | What runs | When |
| --- | --- | --- | --- |
| fast | `pnpm mwc check --fast` | Biome, `tsc --noEmit` per package (cli, db, shared, server, web), db drift (migrations and `docs/schema.md`), all Vitest tests on PGlite, no coverage | the git pre-push hook |
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
| `packages/db` | schema constraints, migrations, `migrationStatus`, `queryRows`, the schema diagram | `createTestDb()`: PGlite, or Postgres with `TEST_DB=postgres` |
| `apps/server` | the API through `app.request()` (health, readiness, errors, request ids, OpenAPI, docs, static UI), the logger, graceful shutdown, one real `serve()` on an ephemeral port | `createTestApp()` on `createTestDb()` |
| `apps/web` | `e2e/shell.spec.ts` (the shell and "API v… · ready"), `e2e/bundle.spec.ts` (no server code in the bundle) | the in-memory API |

## Running one piece

```sh
pnpm exec vitest run --project server                 # one package's tests on PGlite
pnpm exec vitest run apps/server/src/health.test.ts   # one file
pnpm mwc dev                                          # or just the dev Postgres: docker compose -f deploy/compose.yml up -d --wait postgres
TEST_DB=postgres TEST_DATABASE_URL=postgres://mwc:mwc@localhost:9952/mwc pnpm exec vitest run
pnpm e2e                                              # web build + Playwright smoke
```

Keep tests cheap to run: the Mac bills every process start, so tests drive code in-process
(`app.request()`, injected spawn/exec fakes) and start real processes only where the process itself is
what is being tested.
