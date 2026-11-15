---
name: keep-structure
description: Where code goes in Most Wanted Corp v2 and how to keep the layout clean. Use whenever you add, move, rename or split files in this repository; create a server module, a workspace package or a connector; change the database schema or write a migration; add or move tests or test helpers; when a file grows long (near 300 lines of source or 500 of tests); when the structure step of mwc check fails; when mwc structure --report warnings (or the structure warnings at the end of mwc check) show up or keep growing; and for a structure review at each end of stage (before the stage's tag) or whenever Ihor asks for one.
---

# Keep the structure

The map and every rule are in `docs/structure.md`; read it when this page is not enough. The structure
step of `pnpm mwc check` enforces them from one object, `packages/cli/src/structure/rules.ts`.

## Before writing code: decide the place

Read the `open` lessons in [references/lessons.md](references/lessons.md) first (where this table fell short; skip `lessons-archive.md`).

| **Server**: you are writing                                            | It goes in                                                        |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| An HTTP route: path, method, validation, status codes                  | `apps/server/src/modules/<area>/routes.ts`; past about three routes, `routes/<path group>.ts` mounted by `routes.ts` |
| Business logic: decisions, orchestration, transactions                 | `modules/<area>/service.ts` (later `service/<use-case>.ts`)       |
| SQL or Drizzle queries                                                 | `modules/<area>/repo.ts`, through `tenant(db, companyId)`; a second table gets `repo/<entity>.ts` |
| Request and response shapes; a pure rule (no I/O: a validation, a state transition, routing) | `modules/<area>/schemas.ts` (zod-openapi); `modules/<area>/rules.ts` |
| A person's own rows, in no company (subscriptions, profiles)           | a personal table with `owner_user_id`, through `owned(db, userId)`; its routes under `/api/me/…` with `personalRoute(deps, …)` |
| A personal row that company rows point at (an access profile)          | the company's module reads it through `ownersOf` / `ownedIn`; the owner's module asks that module's service for its uses and writes company rows in its own transaction with `o.tenant(companyId)` |
| A read across the caller's companies, or of a person's profile         | the identity module's service (`companiesOf`, `profileOf`); never a new raw-access exemption |
| A store that must see every company (the identity store, the runner hub) | `modules/<area>/repo.ts` with raw access (`@mwc/db/system`), listed in the `biome.json` exemption |
| Module A acting on a change module B makes, in B's transaction         | a port B defines, implemented by A's service and passed in by `app.ts` (as `withMemberChart`); never an import that closes a module cycle |
| A check every route of one entity shares (a chat's people)             | the module's own route wrapper in `routes/access.ts`, after the company's guard |
| A read model of one module over another's tables (a contact's conversations) | its own `repo/<view>.ts` through the tenant layer; the other module's pure rules through its `index.ts` |
| A read several modules show of another module's rows (names)           | the owning module's service, exported by its `index.ts`; a module the owner itself calls imports that service file directly |
| Tools a turn gets that the server defines and answers                  | a port the chats module defines (`ServerToolsHook`), implemented by the module that owns the outside system, passed by `app.ts` |
| An outside message that starts an agent's turn (a Slack message)       | the chats module's `InboundChats`, its end through `InboundTurnHook` |
| Cross-cutting code without business rules (http, auth, jobs, realtime); code that runs local processes or containers for the server (the sign-in helper) | `apps/server/src/platform/`; those processes in `platform/processes/<area>/`, with `spawn` injected |
| A periodic job that needs the app's live runtime (the runner hub's sockets, live turns) | its module's `service/<area>/tick.ts`, started by `createApp` behind `MWC_JOBS`, its timers injectable |
| A WebSocket route                                                      | its module's routes (auth as middleware); the transport in `platform/realtime/` |
| Anything that talks to an outside system (Clerk, Claude Code, Jira)    | a connector `connectors/<name>/` implementing a `packages/*-core` port |
| A port for an outside tool the agents use through the server (Atlassian, GitHub); helpers several of them share | `packages/tools-core`, its connector in `connectors/<system>`, made in `platform/<system>.ts`; the shared answers and replies in the integrations module's `rules/` and `service/`, not under one provider's folder |
| A long-lived connection to an outside system (a socket)                | its client in the connector behind a `*-core` port; its lifecycle in the owning module's `service/<system>/`, started by a `start.ts` the module exports to `app.ts` |
| A small read-only call to an outside system that one module owns (a usage check) | that module's `service/<provider>.ts` behind the injected `providerFetch`; a connector once a second module or the runner needs it |
| A contract several packages share: zod schemas, ids, enums, protocols  | `packages/shared`                                                 |
| An area's limits that its contract parts share                         | `packages/shared/src/<area>/limits.ts`, re-exported by the area's barrel, which its parts never import |
| Runtime code another package reuses that is not a contract (the saved logins, the API client the CLI and the MCP server share) | its owner's `src/`, as a subpath export (`@mwc/cli/credentials`, `@mwc/cli/api/*`) |
| Tables, columns, constraints                                           | `packages/db/src/schema/` (then the database routine below)       |
| A constant about a table's columns that several modules share (a profile's parts) | `packages/db/src/<table-part>.ts`, exported by `src/index.ts`; `schema/` holds tables and their types only |
| A dev tool or a one-shot command                                       | the package's `scripts/`                                          |

| **Tests**: you are writing                                             | It goes in                                                        |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| A test of one source file                                              | the mirrored path, `src/a/b.ts` → `test/a/b.test.ts`; split along its seams as `test/a/b/<part>.test.ts` (a routes file's groups too) |
| A scenario: one story across modules over the HTTP API (a stage's acceptance) | `apps/server/test/scenarios/`, its helpers in `test/fixtures/<scenario>/` |
| A test of a migration's data step (`-- custom:`)                       | `packages/db/test/schema/<table>-backfill.test.ts`, seeded at the migration before with `migrateUpTo` |
| A route only tests need (a probe for platform middleware)              | the package's `test/fixtures/`, mounted on the test app; never in `src/` |
| A check that guards the web from outside it (its routes against the reserved slugs) | the server's tests, as `test/platform/http/web.test.ts`   |
| A test helper several packages use; one that one package's tests use   | `packages/testkit` (its own `@mwc/testkit/<name>` export when it needs no server or database), or exported from the owner's `src/`; that package's `test/fixtures/`, grouped by module (`fixtures/<module>/`) |
| An opt-in test (real Clerk) reusing another package's test fixtures    | a relative import, loaded only when the run starts, said in the file's header |

| **Web** (`apps/web/src/`): you are writing                             | It goes in                                                        |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| A shared component                                                     | `components/<group>/` by role (`ui`, `forms`, `data`, `feed`, `layout`, `org`, `auth`), one per file, exported by the group's barrel |
| A page's own parts                                                     | `features/<area>/`                                                |
| A page; a development-only page (the gallery); styles and design tokens | `pages/`; `pages/design/`, behind `import.meta.env.DEV`; `styles/` |
| A hook or context that calls the API, the inferred API types           | `api/`                                                            |
| The session, the router, the shells, the company links                 | `app/`                                                            |

| **Runner** (`apps/runner/src/`): you are writing                       | It goes in                                                        |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| The link to the server: the socket, heartbeats, the server's commands  | `link/`                                                           |
| Keeping the machine awake (the hold drivers); its stats (the sampler)  | `hold/`; `stats/`                                                 |
| A power executor and the tunnels it runs                               | `power/`; the tunnels' supervisor itself in `@mwc/machines-core/tunnels` |
| Terminal sessions; the self-update                                     | `terminal/`; `update/`                                            |
| A script the runner writes for a harness's tools (git hooks)           | a string constant in `turns/<tool>/`, tested by running it        |
| Enrolling the machine and installing it as a service                   | `install/` (enrolling in `install/enroll/`)                       |
| The daemon (its contract, start, health); the real Node deps and the log | `daemon/`; `system/`, injected everywhere else                    |

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
4. `index.ts` exports `<area>Routes(deps)`; mount it in `apps/server/src/app.ts`. Tick the step in `docs/roadmap.md`.

## New workspace package or connector

The steps and the templates: [references/new-package.md](references/new-package.md); a connector defines or
extends its `packages/*-core` port first, with a fake.

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
- A function over about 60 lines (a web component or hook: 100) is a smell: split it into named steps.
- `pnpm mwc structure --report` lists the hot spots before anything fails: files above 80% of their limit,
  functions over 60 lines (a web component or hook: 100), folders over 12 entries (20: each web `components/`
  folder, web `api/`, db schema, shared `src/` and `test/`; a mirrored test folder gets its source's), files that 8
  or more files of their package import for their values (not type-only; a server module counts once; never the
  web's `components/`, `api/`, `app/`, the server's `platform/http/` or the db schema), and the weakest-covered
  files. `mwc check` ends with a summary. When the file you are changing is listed, split it then; the rest waits.
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

A case the table above did not cover, an awkward placement, a split that went badly or a warning that keeps coming
back: add a dated `open` entry to [references/lessons.md](references/lessons.md). Never change a rule or the table
yourself: the end-of-stage review brings at most 5 to Ihor ([references/review.md](references/review.md)).

## Finish line

Run `pnpm mwc check` (`--full` when the database, the server or the web changed). A structure failure reads
`path[:line]: [rule] reason`, explained in `docs/structure.md`, "What mwc check enforces". A rule changes only with
Ihor's approval, in `rules.ts`, its tests, `docs/structure.md` and this skill together (the `docs` rule checks).
