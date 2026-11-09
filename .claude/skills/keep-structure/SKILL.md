---
name: keep-structure
description: Where code goes in Most Wanted Corp v2 and how to keep the layout clean. Use whenever you add, move, rename or split files in this repository; create a server module, a workspace package or a connector; change the database schema or write a migration; add or move tests or test helpers; when a file grows long (near 300 lines of source or 500 of tests); when the structure step of mwc check fails; when mwc structure --report warnings (or the structure warnings at the end of mwc check) show up or keep growing; and for a structure review at each end of stage (before the stage's tag) or whenever Ihor asks for one.
---

# Keep the structure

The map and every rule are in `docs/structure.md`; read it when this page is not enough. The structure
step of `pnpm mwc check` enforces them from one object, `packages/cli/src/structure/rules.ts`.

## Before writing code: decide the place

Read the `open` lessons in [references/lessons.md](references/lessons.md) first. They record where this table
fell short; settled ones are in `lessons-archive.md`, which you do not need to read.

**Server**

| You are writing                                                        | It goes in                                                        |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| An HTTP route: path, method, validation, status codes                  | `apps/server/src/modules/<area>/routes.ts`; past about three routes, `routes/<path group>.ts` mounted by `routes.ts` |
| Business logic: decisions, orchestration, transactions                 | `modules/<area>/service.ts` (later `service/<use-case>.ts`)       |
| SQL or Drizzle queries                                                 | `modules/<area>/repo.ts`, through `tenant(db, companyId)`; a second table gets `repo/<entity>.ts` |
| Request and response shapes                                            | `modules/<area>/schemas.ts` (zod-openapi)                         |
| A pure rule (no I/O): a validation, a state transition, routing        | `modules/<area>/rules.ts`                                         |
| A person's own rows, in no company (subscriptions, profiles)           | a personal table with `owner_user_id`, through `owned(db, userId)`; its routes under `/api/me/…` with `personalRoute(deps, …)` |
| A personal row that company rows point at (an access profile)          | the company's module reads it through `ownersOf` / `ownedIn`; the owner's module asks that module's service for its uses and writes company rows in its own transaction with `o.tenant(companyId)` |
| A read across the caller's companies, or of a person's profile         | the identity module's service (`companiesOf`, `profileOf`); never a new raw-access exemption |
| A store that must see every company (the identity store, the runner hub) | `modules/<area>/repo.ts` with raw access (`@mwc/db/system`), listed in the `biome.json` exemption |
| Module A acting on a change module B makes, in B's transaction         | a port B defines, implemented by A's service and passed in by `app.ts` (as `withMemberChart`); never an import that closes a module cycle |
| Cross-cutting code without business rules (http, auth, jobs, realtime) | `apps/server/src/platform/`                                       |
| Code that runs local processes or containers for the server (the sign-in helper) | `apps/server/src/platform/<area>/`, with `spawn` injected   |
| Anything that talks to an outside system (Clerk, Claude Code, Jira)    | a connector `connectors/<name>/` implementing a `packages/*-core` port |
| A small read-only call to an outside system that one module owns (a usage check) | that module's `service/<provider>.ts` behind the injected `providerFetch`; a connector once a second module or the runner needs it |
| A contract several packages share: zod schemas, ids, enums, protocols  | `packages/shared`                                                 |
| Runtime code another package reuses that is not a contract (the saved logins, the API client the CLI and the MCP server share) | its owner's `src/`, as a subpath export (`@mwc/cli/credentials`, `@mwc/cli/api/*`) |
| Tables, columns, constraints                                           | `packages/db/src/schema/` (then the database routine below)       |
| A dev tool or a one-shot command                                       | the package's `scripts/`                                          |

**Tests**

| You are writing                                                        | It goes in                                                        |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| A test of one source file                                              | the mirrored path, `src/a/b.ts` → `test/a/b.test.ts`; split along its seams as `test/a/b/<part>.test.ts` (a routes file's groups too) |
| A scenario: one story across modules over the HTTP API (a stage's acceptance) | `apps/server/test/scenarios/`, its helpers in `test/fixtures/<scenario>/` |
| A test of a migration's data step (`-- custom:`)                       | `packages/db/test/schema/<table>-backfill.test.ts`, seeded at the migration before with `migrateUpTo` |
| A route only tests need (a probe for platform middleware)              | the package's `test/fixtures/`, mounted on the test app; never in `src/` |
| A check that guards the web from outside it (its routes against the reserved slugs) | the server's tests, as `test/platform/http/web.test.ts`   |
| A test helper several packages use                                     | `packages/testkit` (its own `@mwc/testkit/<name>` export when it needs no server or database), or exported from the owner's `src/` |
| A test helper one package's tests use                                  | that package's `test/fixtures/`, grouped by module (`fixtures/<module>/`) |
| An opt-in test (real Clerk) reusing another package's test fixtures    | a relative import, loaded only when the run starts, said in the file's header |

**Web** (`apps/web/src/`)

| You are writing                                                        | It goes in                                                        |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| A shared component                                                     | `components/<group>/` by role (`ui`, `forms`, `data`, `feed`, `layout`, `org`, `auth`), one per file, exported by the group's barrel |
| A page's own parts                                                     | `features/<area>/`                                                |
| A page; styles and design tokens                                       | `pages/`; `styles/`                                               |
| A hook or context that calls the API, the inferred API types           | `api/`                                                            |
| The session, the router, the shells, the company links                 | `app/`                                                            |
| A development-only page (the gallery)                                  | `pages/design/`, behind `import.meta.env.DEV`                     |

Never: a test under `src/`; a non-test file in `test/` outside `test/fixtures/`; a new top-level folder; an
empty folder for a later stage; a module importing another module's `repo.ts` (call its service); a module
importing a connector (depend on the port, wire the connector in `app.ts`); a call to another module's service
inside a tenant transaction (read before it: PGlite's one connection hangs); logic in an `index.ts`.

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
2. Tenant rules: every tenant table has `company_id` and `UNIQUE(company_id, id)` (a table with one row per
   company or per parent has `company_id` or `(company_id, parent_id)` as its primary key and no `id`, as
   `company_logos` and `org_positions`); child foreign keys are
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
- `pnpm mwc structure --report` lists the hot spots before anything fails: files above 80% of their limit,
  functions over 60 lines, folders over 12 entries (20: each web `components/` folder, web `api/`, db schema,
  shared `src/` and `test/`; a mirrored test folder gets its source's), files that 8 or more files of their
  package import for their values (type-only imports left out, a server module counted once, the web's
  `components/`, `api/` and `app/` never listed), and the weakest-covered files. `mwc check` ends with a
  summary of it. When the file you are changing is listed, split it then; the other hot spots wait for review.
- Worked example: [references/splitting.md](references/splitting.md).

## Tests

- Server code is tested through `app.request()` on `createTestApp()` (`@mwc/testkit`), outside systems
  through their fakes; write database tests that pass on PGlite and on Postgres.
- Coverage floors: 90% lines, statements and functions and 85% branches overall; 85% lines and 75%
  branches per file. Exclusions are only the `src/index.ts` barrels, the entries (`apps/server/src/main.ts`,
  `packages/cli/src/mwc.ts`, `packages/mcp/src/main.ts`, `apps/runner/src/main.ts`, `scripts/`) and `apps/web`: add
  tests, never exclusions.
- No frontend tests for now: the web is typechecked and built, not tested.
- Keep process starts few (the Mac bills each one): drive code in-process with injected fakes.

## Lessons and review

When the table above did not cover your case, a rule forced an awkward placement, a split went badly or a warning
keeps coming back, add a dated `open` entry to [references/lessons.md](references/lessons.md) (format at its top).
Never change a rule or the table yourself. The structure review, at each end of stage before the tag (and when the
report clearly grows, or Ihor asks), brings at most 5 suggestions to Ihor: [references/review.md](references/review.md).

## Finish line

Run `pnpm mwc check` (`--full` when the database, the server or the web changed). A structure failure reads
`path[:line]: [rule] reason`, explained in `docs/structure.md`, "What mwc check enforces". A rule changes only with
Ihor's approval, in `rules.ts`, its tests, `docs/structure.md` and this skill together (the `docs` rule checks).
