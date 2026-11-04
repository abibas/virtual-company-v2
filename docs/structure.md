# Structure

Where code goes in this repository: the layout Ihor approved on 2026-11-04 and the rules that keep it.
The stage column (S0–S7) says when a part lands (`docs/roadmap.md`). Folders of later stages are not
created ahead of time (no empty placeholders); this map is where they will go. The project skill
`keep-structure` (`.claude/skills/keep-structure/SKILL.md`, with a module template and a worked split in
its `references/`) is the short, practical version: load it before adding, moving or splitting files, or
changing the schema.

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
│   │   │   │   ├── auth/           who is calling, role checks                 S1
│   │   │   │   ├── jobs/           background loops: outbox, reconcile, reaper S1/S4
│   │   │   │   └── realtime/       live updates to UI, runner connections      S3/S4
│   │   │   ├── modules/            one folder per business area
│   │   │   │   ├── health/         routes · service · repo · schemas           S0
│   │   │   │   ├── identity/       me, Clerk webhooks, sync                    S1
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
│   ├── testkit/                    test helpers
│   ├── cli/                        mwc
│   └── mcp/                        tools for your own Claude Code              S5
├── connectors/                     adapters to outside systems
│   ├── identity-clerk/                                                         S1.2
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
stay in `src/` and are exported: `@mwc/db/testing` (test databases), `@mwc/identity-core/fake` and
`/memory-store` (the identity test doubles), and `@mwc/testkit` as a whole. Helpers only a package's own
tests use live in its `test/fixtures/` (e.g. `packages/identity-core/test/fixtures/world.ts`).

## The server (`apps/server`)

- `src/main.ts` is a 3-line entry: it calls `start(process.env)` from `platform/start.ts`, which holds
  all of the startup (configuration, logger, database, migrate-on-start, the app, listen, graceful
  shutdown) with every outside effect injectable, so it is tested without Postgres or a port.
- `src/app.ts` builds the Hono app: the platform middleware and handlers around the modules' routers.
- `src/platform/` holds cross-cutting code without business rules: `env.ts` (the app's dependencies and
  Hono environment), `logger.ts`, `shutdown.ts`, `version.ts`, `start.ts`, and `http/` (the router
  factory, request log, errors, the OpenAPI document and Swagger UI, the static web UI). Later `auth/`,
  `jobs/` and `realtime/`.
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

## Size limits

- Source files: at most 300 lines. Test files (everything under `test/`): at most 500 lines.
- Markdown docs are not limited. Generated files are exempt: `packages/db/migrations/` (with
  `migrations/meta/`), `docs/schema.md`, `pnpm-lock.yaml`.
- A file over the limit is split by responsibility into cohesive files, without changing behaviour; a
  public import path stays stable by keeping the original file as the entry, or a folder `index.ts`
  that only re-exports.
- A function longer than about 60 lines is a smell: split it (guidance, not enforced).

The structure step of `mwc check` enforces the limits (below).

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

## What `mwc check` enforces

The `structure` step runs in every lane (fast, default, `--full`), inside the `mwc check` process, on the
files git tracks plus the untracked ones it does not ignore (the same listing as the banned-names step);
`pnpm mwc structure` runs it alone. Each broken rule is one line, `path[:line]: [rule] reason`, followed by
where the rules are and "see .claude/skills/keep-structure". The limits and allow-lists are one object,
`packages/cli/src/structure/rules.ts`.

| Rule      | Fails on                                                                                                  |
| --------- | --------------------------------------------------------------------------------------------------------- |
| `layout`  | a top-level entry not listed above; a file loose in `apps/`, `packages/` or `connectors/`; a `package.json` anywhere but the root and `<group>/<name>/` |
| `package` | a package without `package.json`, `tsconfig.json` or `src/`; a tested one without `vitest.config.ts` or a test in `test/`; tests in `apps/web`; any other entry at a package root than those in the table above |
| `tests`   | a `*.test.ts`/`*.spec.ts` under `src/` (it names the mirrored path) or anywhere else outside a package's `test/`; a file in `test/` that is not a test, outside `test/fixtures/` |
| `size`    | a source file over 300 lines or a file in `test/` over 500 (it names the first line over), except the generated files and Markdown |
| `modules` | a file directly in `modules/`; a file in `modules/<area>/` that is not one of the role files or inside a role folder; an import of another module's `repo.ts` or `repo/`; an import of a connector package in a module |

The coverage floors are Vitest's thresholds (the root `vitest.config.ts`), checked by the tests step, and
the "db drift" step checks the migrations and `docs/schema.md` against the schema.
