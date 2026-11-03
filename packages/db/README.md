# @mwc/db

The Postgres schema (Drizzle), its SQL migrations, and database handles for Most Wanted Corp v2.

| Import            | What                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------- |
| `@mwc/db`         | `createDb(url, { poolSize })` (postgres.js, lazy connect), `migrateToLatest(handle)`, `diffFields`, the tables |
| `@mwc/db/schema`  | the Drizzle tables and row types only                                                  |
| `@mwc/db/pglite`  | `createPgliteDb()`: an in-memory PGlite handle for tests (PGlite is a dev dependency)   |
| `@mwc/db/migrate` | `migrateToLatest(handle, { migrationsFolder? })`, `MIGRATIONS_FOLDER`                   |

Both handles are `{ driver, db, close() }`; `migrateToLatest` takes either and applies every migration
not yet recorded in `drizzle.__drizzle_migrations` (a second run is a no-op).

## Changing the schema

1. Edit the tables in `src/schema/` (one file per table group, re-exported from `src/schema/index.ts`).
2. `pnpm --filter @mwc/db generate --name <change>` writes `migrations/NNNN_<change>.sql` and its
   snapshot in `migrations/meta/`.
3. Review the SQL. Constraints come from the schema (`check()`, `unique()`, `index()`, references), so
   the generated file is the whole truth; do not hand-edit it. If drizzle-kit cannot express something,
   append it to the generated file under a `-- custom:` comment that says why.
4. Add or update the tests in `src/*.test.ts` (they run on PGlite), then `pnpm mwc check`.

Migrations are forward-only: never edit a migration that has been committed; write a new one.
`pnpm --filter @mwc/db check:migrations` (also a step of `pnpm mwc check`) fails when the schema and
`migrations/` disagree, that is when `generate` would write a new file.

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
- Tests use `createPgliteDb()` + `migrateToLatest()`: a real Postgres in WebAssembly, in memory.
