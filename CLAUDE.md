# Most Wanted Corp v2

A from-scratch rebuild of the Most Wanted corporation product: humans and AI agents in one
organization, tasks, runs of Claude Code harnesses on remote machines, and an inbox for what
needs a human. Approved by Ihor Herasko on 2026-11-03. The plan is `docs/plan-2026-11-03.md`;
the living documents are `docs/architecture.md`, `docs/roadmap.md`, `docs/ports.md`, `docs/structure.md`.

## Rules

- **Earlier versions are reference only.** Earlier versions of the product live outside this
  repository. They are reference only: never edit, run, restart or deploy them from here, and never
  read their databases, data folders, `.env` files, keys or sign-ins.
- **No legacy naming.** Names, paths and identifiers from earlier versions never appear in code,
  schema, docs or commit messages; `mwc check` enforces the banned list (`packages/cli/src/banned.ts`).
- **Ports 9950–9999 only.** API 9950, web 9951, Postgres 9952, runner health 9953, worktree
  slots 9960–9989 (`pnpm mwc ports --slot N`), prod-like compose 9990–9992, the visible test browser's
  debugging port 9993 (a browser started outside the repo; no repo code starts it). See `docs/ports.md`.
- **No secrets in the repo.** Configuration comes from the environment (`.env.example` lists the
  keys; `.env` is ignored and never read aloud). Credentials are encrypted at rest with a key
  that lives outside the repo.
- **Tenant id everywhere.** Every tenant table has `company_id`, child foreign keys are composite
  `(company_id, parent_id)`, and route code reaches tenant data only through `tenant(db, companyId)`. Raw
  access is `@mwc/db/system`, which Biome forbids in server modules except the identity repo (`docs/structure.md`,
  "The tenant layer").
- **Tests with every ticket.** A ticket is done when its unit/integration tests are green in
  `pnpm mwc check`. Unit tests for domain code, integration tests for the API on PGlite, runner
  and harness tests against fakes. No frontend tests for now (no UI unit tests, no browser smoke).
- **One step at a time.** Work is delivered step by step; after each step Ihor reviews and
  approves before the next one starts. Commit small, with a message that says what was built and
  how it was verified.
- **Commits are Ihor's.** Every commit is authored and committed as `Ihor Herasko <mostwantedyeah@gmail.com>`
  (set in this repo's git config). No `Co-Authored-By`, "Generated with", or any other trailer or text
  that attributes the work to someone or something else. Commit messages say what was built and how
  it was verified.
- **Everything goes to `main`, in good commits.** For now there are no feature branches or pull requests:
  commit straight to `main`, one coherent change per commit, and push to `origin`
  (`github.com/abibas/virtual-company-v2`, private) at the end of each approved step. Never make the
  repository public or add another remote without Ihor's request.
- **Agents, runs and machines start only on Ihor's request.** Never enroll a machine, start a
  run, send a task message as him, or answer an inbox item for him.

## Toolchain

Node 24 (`.nvmrc`), pnpm (pinned in `package.json`), TypeScript 7, Biome, Vitest.
Relative imports use the `.ts` extension; packages export TypeScript sources directly
(bundling happens only for the deployable images). `index.ts` is for barrel re-exports only;
executable entry points are `apps/server/src/main.ts`, `packages/cli/src/mwc.ts`, `packages/mcp/src/main.ts`, `apps/runner/src/main.ts` and
files in a package's `scripts/` (coverage excludes only those, the `src/index.ts` barrels and `apps/web`).
Coverage reports go to `.cache/coverage` (ignored). Biome does not format Markdown.
`docs/schema.md` is generated; after a schema change run `pnpm --filter @mwc/db generate` and
`pnpm --filter @mwc/db diagram`.

```sh
pnpm install            # also installs the git hooks (pre-push, commit-msg)
pnpm dev                # dev Postgres (Docker, 9952) + migrations + API 9950 (with .env, then .env.local) + web 9951; mwc dev --down stops PG
pnpm mwc check          # biome, banned names, structure, typecheck per package, db drift, tests with coverage
pnpm mwc check --fast   # the same without coverage (what the pre-push hook runs)
pnpm mwc check --full   # + tests on the dev Postgres and the web build (docs/testing.md)
pnpm mwc structure --report  # early warnings: hot spots before a structure rule fails; never fails
pnpm mwc dev outbox     # the notification emails the dev server wrote to .data/outbox/ instead of sending (docs/notifications.md)
pnpm mwc ports          # the port map
pnpm mwc login --server URL --company ID|SLUG  # save a personal API key (MWC_API_KEY or stdin, never an argument)
pnpm mwc whoami         # who the saved key (or MWC_SERVER + MWC_API_KEY) acts as; mwc logout removes it
pnpm mwc org tree       # the org chart as an indented tree; mwc agents list: the agents as a table (--json for both)
```

`@mwc/mcp` (`packages/mcp`) is the MCP server for a person's own Claude Code (`me`, `org_chart`, `agents_list`), with
the same login; adding it (`claude mcp add mwc -- node <repo>/packages/mcp/src/main.ts`) is the person's own step,
never done from here (`docs/mcp.md`).

`deploy/`: `compose.yml` is the dev Postgres only; `compose.prod.yml` is the prod-like stack (9990/9992)
built from `Dockerfile.server`, whose runtime runs the TypeScript sources on Node 24 directly; `Dockerfile.login` is
the sign-in helper's image (the official Claude Code and Codex CLIs, pinned), which the server builds on the first
sign-in in development (`docs/subscriptions.md`). `mwc`
itself runs on Node's own type stripping too (no tsx). Test helpers come from `@mwc/testkit` (a
devDependency): `createTestApp()`, `createTestDb()` (PGlite by default, a fresh database on the dev
Postgres with `TEST_DB=postgres`; write tests so they pass on both), `fixedClock()`, `getJson`/`postJson`,
`captureLogger()`, `seedCompany()` (a company with its owner and the owner's root position on the org chart), `seedAgent()` (an agent with its place), `seedMember()` and `seedApiKey()` (a person on the chart and a personal key the API accepts), and the identity provider and store contracts (docs/testing.md). The db package's own tests import `@mwc/db/testing` directly.

## How the work is run

The main chat (the CEO office) plans, delegates, merges and verifies. It loads the self-reflection skill
(`.claude/skills/self-reflection`) before briefing a subagent (effort by task size, the brief template) and after
every batch, stage, complaint or incident, to review its own work and get faster.

## Layout

Load the keep-structure skill (`.claude/skills/keep-structure`) before adding, moving or splitting files,
or changing the schema. The map and its rules are `docs/structure.md`. In short: `apps/` are what we deploy (`server`, `web`,
later `runner`), `packages/` the libraries (`shared`, `db`, `identity-core`, `testkit`, `cli`, `mcp`, later
`harness-core`), `connectors/` the adapters to outside systems (`identity-clerk` first, S1.2),
`deploy/` the compose files and Dockerfiles, `docs/`. Folders appear as their stage lands
(`docs/roadmap.md`), never as empty placeholders.

- Every package: `package.json`, `tsconfig.json`, `src/` (code only), `test/` (tests only, mirroring
  `src/`: `src/a/b.ts` → `test/a/b.test.ts`, helpers in `test/fixtures/`), `vitest.config.ts` (not in
  `apps/web`), optional `README.md` and `scripts/` (dev tooling), `migrations/` (db only).
- Size limits: source files ≤ 300 lines, test files ≤ 500; Markdown and generated files are exempt.
  The structure step of `mwc check` enforces the layout and the limits (`packages/cli/src/structure/rules.ts`).
- Coverage: ≥ 90% lines/statements/functions and ≥ 85% branches overall, ≥ 85% lines and ≥ 75%
  branches per file.
- Outside systems only through a connector implementing a `packages/*-core` port, wired in `app.ts`.

`apps/server`: `src/main.ts` is a 3-line entry calling `start(process.env)` from `src/platform/start.ts`
(config, logger, Postgres, migrate-on-start, listen, graceful shutdown; all injectable and tested).
`createApp(deps)` in `src/app.ts` builds the Hono app from injected deps (db handle, config, logger,
version, clock) so tests drive it with `app.request()` on PGlite. `src/platform/` is cross-cutting
code without business rules (`http/`: router, request log, errors, API docs, static UI). Each business
area is a module `src/modules/<area>/` (`routes.ts` HTTP only, `service.ts` logic, `repo.ts` data
through the tenant layer, `schemas.ts` zod, `rules.ts` pure rules, `index.ts` the router factory),
mounted in `createApp`, with zod-openapi routes so `/api/openapi.json` and the web's typed client
(`AppType`) follow the code; modules never import another module's `repo.ts`. Errors are always
`{ error: { code, message, requestId } }`; never put driver errors or stacks in a response.
`src/dev/memory-server.ts` (`pnpm dev:memory`) is the API on an in-memory PGlite for local demos.

`apps/web`: React 19, Vite, Tailwind 4, `@clerk/react` (`src/app/` boot, Clerk root, routes and a small router,
`src/pages/`, `src/components/` the shared component library, `src/features/` each page area's own parts, `src/api/` the typed client, `src/styles/theme.css` the tokens
copied from the shared UI library's `theme.css`; light and dark). It reads Clerk's publishable key from `GET /api/config`
at run time (never built in) and calls the API only through `src/api/client.ts` (`hc<AppType>`, a type-only import of
`@mwc/server`, so no server code is bundled; `Authorization: Bearer <getToken()>` on every call). No frontend tests for
now: `mwc check` typechecks it and `--full` builds it.
