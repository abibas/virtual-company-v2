# @mwc/db

The Postgres schema (Drizzle), its SQL migrations, the tenant layer, and database handles for Most Wanted Corp v2.
The schema drawn as a diagram, with a section per table: [docs/schema.md](../../docs/schema.md) (generated).

| Import            | What                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------- |
| `@mwc/db`         | the tables and row types, `tenant(db, companyId)` with `TenantDb` and `CompanyNotFoundError`, `withNewCompany(db, input, work)` with `SlugTakenError`, `isUuid`, `pingDb(handle)`, `migrationStatus(handle)`, `readJournal()`, `diffFields`, `auditChanges(t, entry)`, `isUniqueViolation(error, constraint?)`, and the `DbHandle` type (a handle without its Drizzle object) |
| `@mwc/db/system`  | raw, unscoped access: `createDb(url, { poolSize, onnotice })` (postgres.js, lazy connect), `migrateToLatest(handle)`, `queryRows(handle, sql)`, `rawDb(handle)` (the Drizzle database), `rawHandle(handle)`. Server modules may not import it (below) |
| `@mwc/db/schema`  | the Drizzle tables and row types only                                                  |
| `@mwc/db/pglite`  | `createPgliteDb()`: an in-memory PGlite handle for tests (PGlite is a dev dependency)   |
| `@mwc/db/testing` | `createTestDb()`: a fresh test database, PGlite by default or a new database on `TEST_DATABASE_URL` with `TEST_DB=postgres` (dropped on `close()`; the first one per process drops `mwc_test_*` leftovers older than 1 hour, `dropStaleTestDbs`; the server is reached through an injectable `TestDbServer`, postgres.js by default), and `pgError(query)`. Test support exported for other packages, so it lives in `src/`; they import it from `@mwc/testkit` |
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

## The tenant layer

`tenant(db, companyId)` is the only way route and service code reaches tenant tables. It reads the company
once and refuses one that is missing, deleted (`status = 'deleted'` or `deleted_at` set) or not a UUID with
`CompanyNotFoundError` (`code: 'not_found'`, a 404 for the caller). Its `TenantDb` (`src/tenant.ts`):

```ts
const t = await tenant(db, companyId);
await t.select(memberships, eq(memberships.status, 'active')).orderBy(asc(memberships.id)); // + company_id = …
await t.insert(principals, { kind: 'person' }).returning();                                 // company_id stamped
await t.update(invitations, { status: 'revoked' }, eq(invitations.id, id)).returning();     // own rows only
await t.delete(apiKeys, eq(apiKeys.id, id));
await t.transaction(async (tx) => { /* the same, in one transaction */ });
t.scoped(memberships); // the scope as SQL, for a join's condition
await t.updateCompany({ name: 'Acme Corp' }).returning();                                   // the company row itself
await t.transaction(async (tx) => tx.lockCompany());                                        // for update; 404 once deleted
await auditChanges(t, { actorKind: 'user', entityType: 'company', entityId: t.companyId, action: 'update', changes });
```

A new company and its first tenant rows go in one transaction with `withNewCompany` (S1.5): it inserts the company
(`provisioning`) with the first free slug of `slugs` (`on conflict do nothing`, so a slug a concurrent create took
moves on to the next instead of aborting the transaction) and runs `work` on a `TenantDb` bound to it; `work`
throwing rolls the company back too, and no free slug rejects with `SlugTakenError`.

```ts
const company = await withNewCompany(db, { name: 'Acme', slugs: ['acme', 'acme-2'], createdByUserId }, async (t) => {
  await t.insert(principals, { kind: 'person' });
  return t.company;
});
```

`isUniqueViolation(error, constraint?)` recognizes SQLSTATE 23505 through Drizzle's wrapper on both drivers
(postgres.js names the constraint `constraint_name`, PGlite `constraint`), so a taken value becomes a 409, not a 500.

A `companyId` passed to `insert` or `update` is replaced or dropped: a row never lands in or moves to another
company. The composite foreign keys refuse a cross-company reference even when a raw query tries it.

Raw access is `@mwc/db/system`: the platform (startup, auth, jobs), migrations and scripts, the webhook inbox
and the identity store. `biome.json` forbids it, with `@mwc/db/pglite`, `/migrate` and `/testing`, under
`apps/server/src/modules/**`, except in the identity module's `repo.ts` and `repo/` (the database
`IdentityStore`, cross-company by nature); `test/system.test.ts` proves the rule fires. A `DbHandle` from
`@mwc/db` has no `db` property in its type, so a module cannot reach the Drizzle object through it either.

## Changing the schema

1. Edit the tables in `src/schema/` (one file per table group, re-exported from `src/schema/index.ts`).
2. `pnpm --filter @mwc/db generate --name <change>` writes `migrations/NNNN_<change>.sql` and its
   snapshot in `migrations/meta/`.
3. Review the SQL. Constraints come from the schema (`check()`, `unique()`, `index()`, references), so
   the generated file is the whole truth; do not hand-edit it. If drizzle-kit cannot express something,
   append it to the generated file under a `-- custom:` comment that says why.
4. Run `pnpm --filter @mwc/db diagram` after a schema change; it rewrites `docs/schema.md` (the Mermaid
   ER diagram and the per-table sections, from `src/diagram.ts`). `mwc check` fails if you forget.
5. Add or update the tests in `test/*.test.ts` (they run on PGlite, and on the dev Postgres in
   `pnpm mwc check --full`), then `pnpm mwc check`.

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
  company (`src/schema/tenant.ts` has the helpers). `companies` is the tenant root; `users` are global.
- The tenant tables (S1.3): `principals` (a person or an agent: the id every actor and assignee column points
  at), `memberships` (one per company and user, each with its own person principal; `role` applies,
  `granted_role` is ours, `provider_role` and `external_membership_id` follow the provider), `invitations` (at
  most one pending per email and company, a partial unique index) and `api_keys` (the SHA-256 of the secret,
  64 lower-case hex digits; a runner key needs its `machine_id`). `audit_log.actor_principal_id` points at a
  principal of the row's company.
- The global identity tables: `user_identities` (a person is `(issuer, subject)`, unique; two users may share an
  email), `identity_events` (the inbox, unique on `(provider, external_event_id)`), `identity_outbox` (provider
  calls, unique `idempotency_key`), and the projector's `identity_marks` and `identity_parked_events`.
- `users.primary_email` is stored lower-cased (a CHECK refuses anything else) and is not unique; `companies.slug` is
  lower-case kebab, 1–63 characters.
- `audit_log` is append-only, one row per changed field (`diffFields(before, after)` makes them);
  `company_id` is null for global events.
- Tests use `createTestDb()` + `migrateToLatest()`: a real Postgres in WebAssembly, in memory, and in
  `mwc check --full` the same tests on the dev Postgres 17 (`TEST_DB=postgres`), so write them through
  `queryRows` and Drizzle rather than a driver's own API.
