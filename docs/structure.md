# Structure

Where code goes in this repository: the layout Ihor approved on 2026-11-04 and the rules that keep it.
The stage column (S0–S7) says when a part lands (`docs/roadmap.md`). Folders of later stages are not
created ahead of time (no empty placeholders); this map is where they will go. The project skill
`keep-structure` (`.claude/skills/keep-structure/SKILL.md`, with a module template, a worked split, the
lessons log and the structure review in its `references/`) is the short, practical version: load it before
adding, moving or splitting files, or changing the schema, and for the review at the end of each stage.

## The map

```
Most_Wanted_corp_v2/
├── apps/                           things we deploy
│   ├── server/                     the API: full test coverage
│   │   ├── src/
│   │   │   ├── main.ts             3-line entry only
│   │   │   ├── app.ts              wires platform + modules
│   │   │   ├── platform/           cross-cutting, no business rules
│   │   │   │   ├── http/           router, request id, logging, errors, API docs, static UI
│   │   │   │   ├── auth/           who is calling, role checks (built)         S1.4
│   │   │   │   ├── jobs/           background loops: outbox, reconcile, reaper S1/S4
│   │   │   │   └── realtime/       live updates to UI, runner connections      S3/S4
│   │   │   ├── modules/            one folder per business area
│   │   │   │   ├── health/         routes · service · repo · schemas           S0
│   │   │   │   ├── identity/       identity store (repo), me, webhooks, sync   S1
│   │   │   │   ├── companies/                                                  S1
│   │   │   │   ├── members/        memberships, invitations                    S1
│   │   │   │   ├── api-keys/                                                   S1
│   │   │   │   ├── org/            agents, reporting chain, org chart          S2
│   │   │   │   ├── machines/       enrollment, placements                      S3
│   │   │   │   ├── tasks/          tasks, messages, kept conversations         S4
│   │   │   │   ├── runs/           runs, events, scheduler                     S4
│   │   │   │   ├── inbox/          questions, permissions, blocked, review     S5
│   │   │   │   ├── credentials/    encrypted store, sign-ins                   S6
│   │   │   │   └── integrations/   Jira intake, PR watch, flows, sprints       S7
│   │   │   └── dev/                in-memory server for local demos
│   │   └── test/                   mirrors src/ one to one
│   ├── web/                        React UI, no tests for now
│   │   └── src/ app/ pages/ components/ api/ styles/
│   └── runner/                     machine daemon                              S3
├── packages/                       libraries, pure where possible
│   ├── shared/                     contracts: config, ports, ids, enums, protocols
│   ├── db/                         schema, migrations, tenant layer
│   ├── identity-core/              identity model and projector                S1
│   ├── harness-core/               harness driver interface                    S4
│   ├── testkit/                    test helpers, provider contract
│   ├── cli/                        mwc
│   └── mcp/                        tools for your own Claude Code              S5
├── connectors/                     adapters to outside systems
│   ├── identity-clerk/             Clerk IdentityProvider (built)              S1.2
│   ├── identity-oidc/              other identity providers, user sync         later
│   ├── harness-claude-code/                                                    S4
│   ├── harness-codex/                                                          S7
│   └── jira/ github/ gateway/                                                  S6–S7
├── deploy/                         Dockerfiles, compose, later Kubernetes
└── docs/                           architecture, roadmap, ports, schema, testing, structure
```

At the top level there is nothing else but the root configuration files (`package.json`,
`pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json`, `vitest.config.ts`, `biome.json`,
`.nvmrc`, `.gitignore`, `.dockerignore`, `.env.example`, `README.md`, `CLAUDE.md`), the git hooks
(`.githooks/`), the project's Claude Code skills (`.claude/`) and the shared editor settings
(`.vscode/settings.json`). Generated output stays out of the tree: coverage reports go to `.cache/`
(ignored), builds to `dist/` (ignored), local data to `.data/` (ignored).

## Workspace packages

Workspace packages live only in `apps/*` (what we deploy), `packages/*` (libraries) and `connectors/*`
(adapters to outside systems); `pnpm-workspace.yaml`, the root `vitest.config.ts` and `mwc check` know
these three groups, and a group without packages yet is fine. Every package has:

| Entry              | What                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------- |
| `package.json`     | name `@mwc/<name>`, exact dependency versions                                         |
| `tsconfig.json`    | extends `tsconfig.base.json`; includes `src`, `test` (and `scripts` when it has them)  |
| `src/`             | code only                                                                             |
| `test/`            | tests only, mirroring `src/`: `src/a/b.ts` → `test/a/b.test.ts`; shared helpers in `test/fixtures/` |
| `vitest.config.ts` | the package's Vitest project, `include: ['test/**/*.test.ts']` (not in `apps/web`)    |
| `README.md`        | optional: what the package offers and its rules                                       |
| `scripts/`         | optional: dev tooling only (one-shot commands, the executable entries of dev tools)   |
| `migrations/`      | `packages/db` only: the generated SQL                                                 |

Tool configuration a package needs sits next to these (`apps/web`: `index.html`, `vite.config.ts`;
`packages/db`: `drizzle.config.ts`). Test helpers that other packages' tests use are code, so they
stay in `src/` and are exported: `@mwc/db/testing` (test databases), `@mwc/identity-core/fake`,
`/memory-store` (the identity test doubles) and `/scenario` (the identity scenario and seeded shuffles), and
`@mwc/testkit` as a whole (also `@mwc/testkit/provider-contract`, the `IdentityProvider` contract every provider
runs, `@mwc/testkit/store-contract`, the `IdentityStore` contract every store runs, and `@mwc/testkit/webhooks`,
svix-signed deliveries, which load without the server). Helpers only a package's own
tests use live in its `test/fixtures/` (e.g. `packages/identity-core/test/fixtures/world.ts`).

## The server (`apps/server`)

- `src/main.ts` is a 3-line entry: it calls `start(process.env)` from `platform/start.ts`, which holds
  all of the startup (configuration, logger, database, migrate-on-start, the app, listen, graceful
  shutdown) with every outside effect injectable, so it is tested without Postgres or a port.
- `src/app.ts` builds the Hono app: the platform middleware and handlers around the modules' routers.
- `src/platform/` holds cross-cutting code without business rules: `env.ts` (the app's dependencies and
  Hono environment), `logger.ts`, `shutdown.ts`, `version.ts`, `start.ts`, and `http/` (the router
  factory, request log, errors, the OpenAPI document and Swagger UI, the static web UI), `identity.ts` (the
  identity provider the configuration names: where the Clerk connector is wired), and `auth/` (S1.4): `authn()`
  turns `Authorization: Bearer` into `c.var.actor` (`session.ts` for session tokens, `api-keys.ts` for API keys,
  `bearer.ts` sorting them by shape, the run token slot), and `requireMembership(role)` (`membership.ts`) guards
  `/api/companies/:companyId/...` with our memberships and puts `c.var.tenant` and `c.var.membership` on the
  context; `actor.ts` holds the types. A module puts them on its routes with zod-openapi's `middleware`, and
  gets the provider and the clock as `ServerDeps` (`env.ts`). Later `jobs/` and `realtime/`.
- `src/modules/<area>/` is one business area. A module has up to these files:

  | File         | Role                                                                            |
  | ------------ | ------------------------------------------------------------------------------- |
  | `routes.ts`  | HTTP only: the zod-openapi routes, each calling the service                    |
  | `service.ts` | the business logic, no HTTP                                                     |
  | `repo.ts`    | database access, through the tenant layer (`tenant(db, companyId)`)            |
  | `schemas.ts` | the zod request and response schemas                                            |
  | `rules.ts`   | pure domain rules (no I/O)                                                      |
  | `index.ts`   | exports the router factory (`createApp` mounts it)                              |

  When one of them outgrows the size limit it becomes a sub-folder with the same role name
  (`service/invite.ts`, `service/remove.ts`). Modules never import another module's `repo.ts`: they
  call its service.
- `src/dev/memory-server.ts` is the API on an in-memory PGlite for local demos (`pnpm dev:memory`, whose
  entry is `scripts/memory-server.ts`).
- `test/` mirrors `src/`. Module and platform behaviour is tested through `app.request()` on a test
  database (`createTestApp()` from `@mwc/testkit`).

## Connectors and ports

An outside system (Clerk, another identity provider, Claude Code, Codex, Jira, GitHub, the AI gateway)
is reached only through a connector in `connectors/<name>/`, which implements a port defined in a
`packages/*-core` package (`IdentityProvider` in `@mwc/identity-core`, later `HarnessDriver` in
`@mwc/harness-core`). Connectors are wired in `apps/server/src/app.ts` (or the runner's equivalent);
modules depend on the port, never on a connector, so tests use the core package's fake.

A connector takes the outside system's client as an injected port, so its unit tests run against a fake with
no network; its contract test against the real system is opt-in and its helpers live in its `test/fixtures/`.
The first one is `connectors/identity-clerk` (S1.2; `docs/clerk-setup.md`).

## Size limits

- Source files: at most 300 lines. Test files (everything under `test/`): at most 500 lines.
- Markdown docs are not limited. Generated files are exempt: `packages/db/migrations/` (with
  `migrations/meta/`), `docs/schema.md`, `pnpm-lock.yaml`.
- A file over the limit is split by responsibility into cohesive files, without changing behaviour; a
  public import path stays stable by keeping the original file as the entry, or a folder `index.ts`
  that only re-exports.
- A function longer than about 60 lines is a smell: split it (guidance, not enforced; the report below
  lists it as `long-function`).

The structure step of `mwc check` enforces the limits (below); its early warnings show a file before it
reaches them.

## Coverage

`pnpm mwc check` runs the tests with v8 coverage (reports in `.cache/coverage/`) and fails below:

- all files together: 90% lines, statements and functions, 85% branches;
- every file on its own: 85% lines, 75% branches (Vitest's `thresholds.perFile`).

Excluded are only the `src/index.ts` barrels, the executable entries (`apps/server/src/main.ts`,
`packages/cli/src/mwc.ts`; `scripts/` are outside `src/`) and `apps/web/**`.

## The web (`apps/web`)

React 19, Vite and Tailwind 4: `src/main.tsx` (the entry), `src/app/` (the app shell), `src/pages/`
(one file per page), `src/components/` (shared pieces, once there are any), `src/api/` (the typed
client, `hc<AppType>`), `src/styles/` (the Tailwind theme and base styles). No frontend tests for now
(no UI unit tests, no browser smoke): `mwc check` typechecks it in every lane and `--full` builds it.

## Database changes

1. Edit the tables in `packages/db/src/schema/`.
2. `pnpm --filter @mwc/db generate --name <change>` writes the migration; never edit generated SQL by
   hand (a `-- custom:` addition says why).
3. Review the SQL.
4. `pnpm --filter @mwc/db diagram` rewrites `docs/schema.md`.
5. Tests in `packages/db/test/` (PGlite by default, the dev Postgres in `--full`), then `pnpm mwc check`;
   its "db drift" step fails if the migration or the diagram was forgotten.

Tenant tables carry `company_id`, child foreign keys are composite `(company_id, parent_id)`, and route
code reaches tenant data only through `tenant(db, companyId)` (`packages/db/README.md`).

## The tenant layer

`@mwc/db` gives code anywhere the schema, `tenant(db, companyId)` and the database checks (`pingDb`,
`migrationStatus`). `tenant()` refuses a company that is missing, deleted or not an id with `CompanyNotFoundError`
(a 404), and its `TenantDb` scopes every statement to the company: reads, updates and deletes get
`company_id = …` added, inserts get `company_id` stamped. A `DbHandle` does not expose its Drizzle object.

Raw, unscoped access (`createDb`, `migrateToLatest`, `queryRows`, `rawDb(handle)`) is `@mwc/db/system`, for the
code that must see every company: the platform (startup, auth, jobs), migrations and scripts, the webhook inbox
and the identity store. `platform/auth` uses it to find a session's person in `user_identities` and an API key by
its hash before any company is known. Biome forbids it, and the other raw entries (`@mwc/db/pglite`, `/migrate`, `/testing`), in
`apps/server/src/modules/**` (`noRestrictedImports` in a `biome.json` override), with one exception: the identity
module's `repo.ts` and `repo/`, the database `IdentityStore` that the projector and the webhook inbox use across
companies. `packages/db/test/system.test.ts` runs Biome on a scratch tree with the repository's overrides to prove
the rule fires in a module and nowhere else. Tests are not restricted.

## What `mwc check` enforces

The `structure` step runs in every lane (fast, default, `--full`), inside the `mwc check` process, on the
files git tracks plus the untracked ones it does not ignore (the same listing as the banned-names step);
`pnpm mwc structure` runs it alone. Each broken rule is one line, `path[:line]: [rule] reason`, followed by
where the rules are and "see .claude/skills/keep-structure". The limits, allow-lists and warning thresholds
are one object, `packages/cli/src/structure/rules.ts`.

| Rule      | Fails on                                                                                                  |
| --------- | --------------------------------------------------------------------------------------------------------- |
| `layout`  | a top-level entry not listed above; a file loose in `apps/`, `packages/` or `connectors/`; a `package.json` anywhere but the root and `<group>/<name>/` |
| `package` | a package without `package.json`, `tsconfig.json` or `src/`; a tested one without `vitest.config.ts` or a test in `test/`; tests in `apps/web`; any other entry at a package root than those in the table above |
| `tests`   | a `*.test.ts`/`*.spec.ts` under `src/` (it names the mirrored path) or anywhere else outside a package's `test/`; a file in `test/` that is not a test, outside `test/fixtures/` |
| `size`    | a source file over 300 lines or a file in `test/` over 500 (it names the first line over), except the generated files and Markdown |
| `modules` | a file directly in `modules/`; a file in `modules/<area>/` that is not one of the role files or inside a role folder; an import of another module's `repo.ts` or `repo/`; an import of a connector package in a module |
| `docs`    | this document or the keep-structure skill behind `rules.ts`: a top-level entry, a workspace group (as `apps/*`) or a module file this document does not mention, or a module file row that `rules.ts` does not have; no warnings row per kind with its thresholds; a module file the skill does not mention, or one it places code in that `rules.ts` does not have; either of them not stating the line limits |

The coverage floors are Vitest's thresholds (the root `vitest.config.ts`), checked by the tests step, and
the "db drift" step checks the migrations and `docs/schema.md` against the schema.

## Early warnings (`mwc structure --report`)

Before a rule fails, `pnpm mwc structure --report` lists the hot spots, grouped by kind and worst first. It
never fails (exit 0), and every lane of `pnpm mwc check` ends with a short summary of it (the count of each
kind and the worst of each) that never changes its exit code; `--fast` leaves coverage out, since it has no
coverage run. Like the structure step it runs inside the `mwc` process, in one pass over the same file
listing. The thresholds are the `warn` section of `rules.ts`:

| Warning         | Listed when                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------- |
| `near-limit`    | a limited file is above 80% of its line limit (240 lines of source, 400 in `test/`)               |
| `long-function` | a named function is over 60 lines, from its first line to its last                               |
| `big-folder`    | a folder has more than 12 direct entries, files and folders (generated folders are skipped)      |
| `fan-in`        | 8 or more files of the same package import a file by a relative path (importers outside `test/`) |
| `low-coverage`  | a file is under 95% lines or 90% branches in the last coverage run (`.cache/coverage/coverage-summary.json`, the json-summary report of the root `vitest.config.ts`); left out when there is none |

`long-function` is a heuristic (`packages/cli/src/structure/functions.ts`), not a parser. Biome 2.6.4 has
`noExcessiveLinesPerFunction`, but only in its own process, and it counts every callback, each `describe`
block of a test included. The heuristic measures function declarations, functions and arrow functions
assigned to a name or a property, and methods; it ends a body at the first later line that starts with `}`
at the header's indentation (Biome's formatting). It does not measure anonymous callbacks or arrows with an
expression body, and a multi-line template literal or return type can end a measure early (an undercount,
never a warning too many).

A warning is not a failure to fix at once. When the file you are changing is listed, split it as part of
the change; the rest waits for the structure review.

## Lessons and the structure review

The lessons log, `.claude/skills/keep-structure/references/lessons.md`, records where the structure did not
fit: a case the placement table did not cover, a rule that forced an awkward placement, a split that went
badly, a warning that kept coming back. Each entry is dated and says what happened, where, what was done, a
suggested change to a rule or to the placement table, and its status (`open`, `adopted` or `declined`).
Agents read the open lessons before deciding where code goes.

The structure review (`.claude/skills/keep-structure/references/review.md`) runs at the end of each stage,
before its tag and the review with Ihor (the last item of every stage in `docs/roadmap.md`), when the
report's warning count clearly grows, and when Ihor asks. It reads `pnpm mwc structure --report` and the
open lessons, and suggests at most 5 concrete improvements to Ihor, each with its evidence (split a file
before it reaches its limit, move one, add a row to the placement table, loosen or tighten a rule). Each
change he approves lands as its own commit, and the lessons it settles are marked `adopted` or `declined`. A
rule changes only with his approval, and then `rules.ts`, its tests, this document and the skill change
together; the `docs` rule fails when they disagree.
