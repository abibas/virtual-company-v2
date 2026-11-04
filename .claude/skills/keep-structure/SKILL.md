---
name: keep-structure
description: Where code goes in Most Wanted Corp v2 and how to keep the layout clean. Use whenever you add, move, rename or split files in this repository; create a server module, a workspace package or a connector; change the database schema or write a migration; add or move tests or test helpers; when a file grows long (near 300 lines of source or 500 of tests); or when the structure step of mwc check fails.
---

# Keep the structure

The map and every rule are in `docs/structure.md`; read it when this page is not enough. The structure
step of `pnpm mwc check` enforces them from one object, `packages/cli/src/structure/rules.ts`.

## Before writing code: decide the place

| You are writing                                                        | It goes in                                                        |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| An HTTP route: path, method, validation, status codes                  | `apps/server/src/modules/<area>/routes.ts`                        |
| Business logic: decisions, orchestration, transactions                 | `modules/<area>/service.ts`                                       |
| SQL or Drizzle queries                                                 | `modules/<area>/repo.ts`, through `tenant(db, companyId)`         |
| Request and response shapes                                            | `modules/<area>/schemas.ts` (zod-openapi)                         |
| A pure rule (no I/O): a validation, a state transition, routing        | `modules/<area>/rules.ts`                                         |
| Cross-cutting code without business rules (http, auth, jobs, realtime) | `apps/server/src/platform/`                                       |
| Anything that talks to an outside system (Clerk, Claude Code, Jira)    | a connector `connectors/<name>/` implementing a `packages/*-core` port |
| A contract several packages share: zod schemas, ids, enums, protocols  | `packages/shared`                                                 |
| Tables, columns, constraints                                           | `packages/db/src/schema/` (then the database routine below)       |
| A test helper several packages use                                     | `packages/testkit`, or exported from the owner's `src/`           |
| A test helper one package's tests use                                  | that package's `test/fixtures/`                                   |
| A dev tool or a one-shot command                                       | the package's `scripts/`                                          |
| UI                                                                     | `apps/web/src/` `pages/`, `components/`, `app/`, `api/`, `styles/` |

Never: a test under `src/`; a non-test file in `test/` outside `test/fixtures/`; a new top-level folder; an
empty folder for a later stage; a module importing another module's `repo.ts` (call its service); a module
importing a connector (depend on the port, wire the connector in `app.ts`); logic in an `index.ts`.

## New server module

1. Check the area on the map in `docs/structure.md`; a new area needs Ihor's approval and a map line.
2. Create `apps/server/src/modules/<area>/` with only the role files you need. Template:
   [references/module-template.md](references/module-template.md).
3. Write the tests first: `apps/server/test/modules/<area>/routes.test.ts` through `app.request()` on
   `createTestApp()`, `rules.test.ts` for the pure rules.
4. `index.ts` exports `<area>Routes(deps)`; mount it in `apps/server/src/app.ts`.
5. Tick the step in `docs/roadmap.md`.

## New workspace package or connector

1. A library goes in `packages/`, something deployed in `apps/`, an adapter to an outside system in
   `connectors/`. Name it `@mwc/<folder>`.
2. Create `package.json` (exact versions), `tsconfig.json`, `vitest.config.ts`, `src/` and `test/` with at
   least one test; templates in [references/new-package.md](references/new-package.md). Discovery is
   automatic (the groups are globbed in `pnpm-workspace.yaml`, the root Vitest config and `mwc check`).
3. Add `"@mwc/<name>": "workspace:*"` where it is used, then `pnpm install`.
4. A connector: define or extend the port in its `packages/*-core` package first, with a fake that
   implements it and tests against the fake; then implement the port in the connector, map the outside
   system's errors to the core's error type, and wire it in `app.ts`. Secrets come from the environment.
5. Update `docs/structure.md` (mark the package as built), `README.md` (Layout) and `docs/roadmap.md`.

## Database changes

1. Edit `packages/db/src/schema/` (one file per table group, re-exported from `schema/index.ts`).
2. Tenant rules: every tenant table has `company_id` and `UNIQUE(company_id, id)`; child foreign keys are
   composite `(company_id, parent_id)` → `(company_id, id)`; enums are `oneOf(column, Enum.options)` with
   the zod enum in `@mwc/shared/enums`; route code reaches tenant tables only through `tenant(db, companyId)`.
3. `pnpm --filter @mwc/db generate --name <change>`, then review the SQL. Never edit generated SQL by hand
   and never edit a committed migration: write a new one. What drizzle-kit cannot express is appended
   under a `-- custom:` comment that says why.
4. `pnpm --filter @mwc/db diagram` rewrites `docs/schema.md`.
5. Tests in `packages/db/test/` (constraints, composite-key rejections with `pgError`), green on PGlite
   (`pnpm mwc check`) and on Postgres (`pnpm mwc check --full`). Its "db drift" step fails when step 3 or 4
   was forgotten.

## File size discipline

- Limits: source files ≤ 300 lines, files in `test/` ≤ 500. Markdown, `pnpm-lock.yaml`,
  `packages/db/migrations/` and `docs/schema.md` are exempt. `pnpm mwc structure` checks them alone.
- Split before the limit, by responsibility, never by line count: one file per handler, per step, per
  concern. A server module's `service.ts` becomes `service/<use-case>.ts`; a package file `x.ts` keeps its
  public functions and moves the parts to `x/<part>.ts`.
- Keep public import paths stable: the original file stays the entry, or a folder `index.ts` that only
  re-exports. Pass callbacks instead of importing back into the entry (no import cycles).
- Split the tests along the same seams (`test/x/<part>.test.ts`), move shared helpers to `test/fixtures/`,
  and keep every test body as it was: the test count is the same before and after.
- A function over about 60 lines is a smell: split it into named steps when you change it.
- Worked example: [references/splitting.md](references/splitting.md).

## Tests

- Mirror the paths: `src/a/b.ts` → `test/a/b.test.ts`.
- Server code is tested through `app.request()` on `createTestApp()` (`@mwc/testkit`), outside systems
  through their fakes; write database tests that pass on PGlite and on Postgres.
- Coverage floors: 90% lines, statements and functions and 85% branches overall; 85% lines and 75%
  branches per file. Exclusions are only the `src/index.ts` barrels, the entries (`apps/server/src/main.ts`,
  `packages/cli/src/mwc.ts`, `scripts/`) and `apps/web`: add tests, never exclusions.
- No frontend tests for now: the web is typechecked and built, not tested.
- Keep process starts few (the Mac bills each one): drive code in-process with injected fakes.

## Finish line

Run `pnpm mwc check` (and `pnpm mwc check --full` when the database, the server or the web changed). A
structure failure reads `path[:line]: [rule] reason`; the rule names (`layout`, `package`, `tests`, `size`,
`modules`) are explained in `docs/structure.md`, "What mwc check enforces". Change a rule only with Ihor's
approval, and then `rules.ts`, its tests and `docs/structure.md` together.
