# @mwc/db

The Postgres schema (Drizzle), its SQL migrations, and database handles for Most Wanted Corp v2.
The schema drawn as a diagram, with a section per table: [docs/schema.md](../../docs/schema.md) (generated).

| Import            | What                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------- |
| `@mwc/db`         | `createDb(url, { poolSize, onnotice })` (postgres.js, lazy connect), `migrateToLatest(handle)`, `migrationStatus(handle)`, `readJournal()`, `queryRows(handle, sql)`, `pingDb(handle)`, `diffFields`, the tables |
| `@mwc/db/schema`  | the Drizzle tables and row types only                                                  |
| `@mwc/db/pglite`  | `createPgliteDb()`: an in-memory PGlite handle for tests (PGlite is a dev dependency)   |
| `@mwc/db/testing` | `createTestDb()`: a fresh test database, PGlite by default or a new database on `TEST_DATABASE_URL` with `TEST_DB=postgres` (dropped on `close()`; the first one per process drops `mwc_test_*` leftovers older than 1 hour, `dropStaleTestDbs`), and `pgError(query)`. Other packages import these from `@mwc/testkit` |
| `@mwc/db/migrate` | `migrateToLatest(handle, { migrationsFolder? })`, `migrationStatus(handle, { journal?, migrationsFolder? })`, `readJournal`, `MIGRATIONS_FOLDER`, `MIGRATIONS_SCHEMA`, `MIGRATIONS_TABLE` |

Both handles are `{ driver, db, close() }`; `migrateToLatest` takes either and applies every migration
not yet recorded in `drizzle.__drizzle_migrations` (a second run is a no-op; the schema and table are
pinned as `MIGRATIONS_SCHEMA`/`MIGRATIONS_TABLE`). `migrationStatus(handle)` returns
`{ applied, expected, last, current }` by Drizzle's own rule (a journal entry counts as applied when its
`when` is not after the newest recorded `created_at`); the server's `/readyz` uses it with the journal it
read once at startup (`{ journal }`), so no request reads the file. `queryRows` runs raw
SQL on either driver and returns the rows as an array (the drivers shape results differently).
`createDb`'s `onnotice` receives Postgres notices (postgres.js prints them with `console.log` otherwise).

`pnpm --filter @mwc/db migrate` (`node scripts/migrate.ts`) applies the migrations to `DATABASE_URL` and
prints the status without the password; `mwc dev` and the compose `migrate` one-shot run it.

## Changing the schema

1. Edit the tables in `src/schema/` (one file per table group, re-exported from `src/schema/index.ts`).
2. `pnpm --filter @mwc/db generate --name <change>` writes `migrations/NNNN_<change>.sql` and its
   snapshot in `migrations/meta/`.
3. Review the SQL. Constraints come from the schema (`check()`, `unique()`, `index()`, references), so
   the generated file is the whole truth; do not hand-edit it. If drizzle-kit cannot express something,
   append it to the generated file under a `-- custom:` comment that says why.
4. Run `pnpm --filter @mwc/db diagram` after a schema change; it rewrites `docs/schema.md` (the Mermaid
   ER diagram and the per-table sections, from `src/diagram.ts`). `mwc check` fails if you forget.
5. Add or update the tests in `src/*.test.ts` (they run on PGlite), then `pnpm mwc check`.

Migrations are forward-only: never edit a migration that has been committed; write a new one.
`pnpm --filter @mwc/db check:migrations` fails when the schema and `migrations/` disagree, that is when
`generate` would write a new file; `pnpm --filter @mwc/db check:diagram` fails when `docs/schema.md` is
not what `diagram` would write. `pnpm mwc check` runs both in its "db drift" step
(`scripts/check-drift.ts`, one Node process).

## Conventions

- Ids are UUID v7 strings made app-side by `newId()` (`@mwc/shared/ids`, the columns' `$defaultFn`),
  so they sort by creation time. `audit_log` uses a `bigserial` id.
- `created_at` / `updated_at` are `timestamptz not null default now()`; Drizzle sets `updated_at` on
  every update.
- Enums are `text` columns with a CHECK built from the zod enum in `@mwc/shared/enums`
  (`oneOf(column, Enum.options)`), so the API and the database accept the same values.
- Every tenant table has `company_id` and `UNIQUE(company_id, id)`, and child foreign keys are
  composite `(company_id, parent_id)` → `(company_id, id)`, so a row can never point into another
  company. `companies` is the tenant root; `users` are global.
- `users.primary_email` is stored lower-cased (a CHECK refuses anything else); `companies.slug` is
  lower-case kebab, 1–63 characters.
- `audit_log` is append-only, one row per changed field (`diffFields(before, after)` makes them);
  `company_id` is null for global events.
- Tests use `createTestDb()` + `migrateToLatest()`: a real Postgres in WebAssembly, in memory, and in
  `mwc check --full` the same tests on the dev Postgres 17 (`TEST_DB=postgres`), so write them through
  `queryRows` and Drizzle rather than a driver's own API.
