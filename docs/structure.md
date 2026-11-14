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
│   │   │   │   ├── http/           router, request id, logging, errors, API docs, static UI, throttle
│   │   │   │   ├── auth/           who is calling, role checks (built)         S1.4
│   │   │   │   ├── secrets/        master keyring: seal, open (built)          S3.1
│   │   │   │   ├── processes/      code that runs local processes for the server (built) S3.2/S4
│   │   │   │   │   ├── login-helper/ the CLIs' logins in a sandbox             S3.2
│   │   │   │   │   ├── power/      the server's own airia CLI driver and tunnels S4
│   │   │   │   │   └── speech/     dictation's whisper.cpp: warm server, CLI fallback (built) S5.2
│   │   │   │   ├── email/          the EmailSender port, the dev outbox (built)  S2.9
│   │   │   │   ├── jobs/           outbox, retry, jobs loop (built); scheduler S1.10/S5
│   │   │   │   └── realtime/       live updates to UI, runner connections      S4/S5
│   │   │   ├── modules/            one folder per business area
│   │   │   │   ├── health/         liveness, readiness, versions, /api/config  S0/S1.11
│   │   │   │   ├── identity/       identity store, me, sync, webhook inbox (built) S1.4–S1.8
│   │   │   │   ├── companies/      create, list, read, rename, soft delete, logo (built) S1.5
│   │   │   │   ├── members/        memberships, invitations (built)             S1.6/S1.7
│   │   │   │   ├── api-keys/       personal keys: make, list, revoke (built)   S1.9
│   │   │   │   ├── org/            agents, reporting chain, org chart (built)  S2
│   │   │   │   ├── notifications/  notices, read marks, settings, email delivery (built) S2.9
│   │   │   │   ├── machines/       enrollment, runner hub, power, stats, placements S4
│   │   │   │   ├── chats/          chats with an agent: turns, events, stream, terminal (built) S5.1b
│   │   │   │   ├── speech/         dictation: POST /api/me/speech/transcribe (built) S5.2
│   │   │   │   ├── tasks/          flows, steps, tasks, history, board (built S5.3a); step runs, artifacts (built S5.3b); agents' tools, decisions (built S6a); the Lead's wake-ups (built S6c); the team room (built 2026-11-12)
│   │   │   │   ├── runs/           runs, events, scheduler                     S5
│   │   │   │   ├── inbox/          what needs a person, computed live (built S6b); permissions S6
│   │   │   │   ├── decisions/      the decision log: what agents record with record_decision (built 2026-11-14)
│   │   │   │   ├── credentials/    subscriptions, sign-in, limits, profiles (built) S3
│   │   │   │   └── integrations/   the agents' Atlassian tools (built S7.1c); Jira intake, PR watch, sprints S7
│   │   │   └── dev/                in-memory server for local demos
│   │   └── test/                   mirrors src/ one to one
│   │       └── scenarios/          stories across modules over the HTTP API     S1.12
│   ├── web/                        React UI, no tests for now (identity pages built) S1.11
│   │   └── src/ app/ pages/ components/ features/ api/ styles/
│   └── runner/                     machine daemon                              S4
│       └── src/ daemon/ link/ hold/ stats/ power/ terminal/ turns/ folders/ tools/ update/ install/ system/ (cli.ts, config.ts, main.ts)
├── packages/                       libraries, pure where possible
│   ├── shared/                     contracts: config, ports, ids, enums, protocols
│   ├── db/                         schema, migrations, tenant layer
│   ├── identity-core/              identity model and projector                S1
│   ├── machines-core/              the machine power driver port, its fake, the tunnels' supervisor S4
│   ├── harness-core/               the harness driver port, its fake and the fake binary (built) S5.1a
│   ├── tools-core/                 the outside tools' ports: AtlassianApi, GitHubApi, SlackApi, their errors (built) S7.1c–e
│   ├── testkit/                    test helpers, provider contract
│   ├── cli/                        mwc; the saved logins (credentials.ts)      S1.9
│   │                               api/ (client, org, session), org/ (commands.ts, render.ts) S2.6
│   │                               api/tasks.ts, tasks/ (commands.ts, render.ts, artifact.ts): mwc task, mwc flow S5.3a–b
│   └── mcp/                        tools for your own Claude Code (built: me, org_chart, agents_list) S2.6
├── connectors/                     adapters to outside systems
│   ├── identity-clerk/             Clerk IdentityProvider (built)              S1.2
│   ├── identity-oidc/              other identity providers, user sync         later
│   ├── machine-airia-devbox/       the Airia devbox's power (airia CLI, gcloud), run by a runner or the server S4
│   ├── harness-claude-code/        Claude Code HarnessDriver, its parser, fixtures (built) S5.1a
│   ├── harness-codex/              Codex HarnessDriver, its parser, fixtures (built) S5.1a
│   ├── atlassian/                  Jira v3 and Confluence v2 for the AtlassianApi, ADF ⇄ Markdown (built) S7.1c
│   ├── github/                     api.github.com for the GitHubApi (built)    S7.1d
│   ├── slack/                      slack.com/api for the SlackApi, Socket Mode (built) S7.1e
│   └── gateway/                                                                S7
├── deploy/                         Dockerfiles, compose, later Kubernetes
└── docs/                           architecture, roadmap, ports, schema, testing, structure, subscriptions, harness
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
runs, `@mwc/testkit/store-contract`, the `IdentityStore` contract every store runs, `@mwc/testkit/webhooks`,
svix-signed deliveries, and `@mwc/testkit/runner`, the runner protocol's fake server and fake runner, the last two
loading without the server), `@mwc/harness-core/fake` (S5.1a: `FakeHarnessDriver`, fake specs and credentials, and the
fake harness binary, whose entry is `packages/harness-core/scripts/fake-harness.ts`, outside coverage, with its logic in
`src/scenario.ts` and its path exported as `FAKE_HARNESS_BIN`) and each harness connector's `/fixtures` (its CLI's
recorded-style turns, for its own tests and the runner's; `docs/harness.md`). Runtime code another package reuses is exported from its
owner's `src/` the same way: `@mwc/cli/credentials` (S1.9), the saved logins of `mwc login`, which `@mwc/mcp` (S2.6)
reads, and what `mwc org tree`, `mwc agents list` and `@mwc/mcp` share (S2.6): `@mwc/cli/api/client` (a GET with a
personal key and the server's refusals), `/api/org` (the chart and agents calls and their shapes), `/api/session` (the key
checked with `GET /api/me`, the company chosen) and `/org/render` (the tree and the table as text); the API key format
both sides check is a contract, in `@mwc/shared/api-keys`. `@mwc/testkit`'s `seedMember` and `seedApiKey` (S2.6) give
those clients' tests people on the chart and a key the real API accepts. Helpers only a package's own
tests use live in its `test/fixtures/` (e.g. `packages/identity-core/test/fixtures/world.ts`).

## The server (`apps/server`)

- `src/main.ts` is a 3-line entry: it calls `start(process.env)` from `platform/start.ts`, which holds
  all of the startup (configuration, logger, database, migrate-on-start, the app, listen, graceful
  shutdown) with every outside effect injectable, so it is tested without Postgres or a port.
- `src/app.ts` builds the Hono app: the platform middleware and handlers around the modules' routers.
- `src/platform/` holds cross-cutting code without business rules: `env.ts` (the app's dependencies and
  Hono environment), `logger.ts`, `shutdown.ts`, `version.ts`, `start.ts`, and `http/` (the router
  factory, request log, errors, the OpenAPI document and Swagger UI, the static web UI, `throttle.ts`: one turn per key
  per interval in the process's memory, S1.12), `identity.ts` (the
  identity provider the configuration names: where the Clerk connector is wired), and `auth/` (S1.4): `authn()`
  turns `Authorization: Bearer` into `c.var.actor` (`session.ts` for session tokens, `api-keys.ts` for API keys and making them (`generateApiKey`, S1.9),
  `bearer.ts` sorting them by shape, the run token slot), and `requireMembership(role)` (`membership.ts`) guards
  `/api/companies/:companyId/...` with our memberships and puts `c.var.tenant` and `c.var.membership` on the
  context; `actor.ts` holds the types. A module puts them on its routes with zod-openapi's `middleware`
  (`companyMember(deps, role)` gives both as the tuple zod-openapi needs to type the handler's `c.var`), and gets
  the provider and the clock as `ServerDeps` (`env.ts`); `companyRoute(deps, { role, path, tag })` (S1.6) is the
  shared base of a company route (the path as a literal type, the tag, the bearer credential, `companyMember` and the
  guard's refusals in the OpenAPI document); `personalRoute(deps, { path, tag })` (`personal.ts`, S3.1) is the same
  for a personal route under `/api/me/...`: `authn()` then `requireSession()` (a signed-in session only, an API key
  403 `session_required`), which puts `c.var.userId` on the context. `secrets/` (S3.1) is the master keyring:
  `keyring.ts` (`Keyring`: seal and open with AES-256-GCM and additional data, key versions) and `master-key.ts`
  (`loadKeyring`: MWC_MASTER_KEY, the development `.data/master.key`, or a test key in memory), which `start.ts`
  loads and `createApp` hands the credentials module. `processes/` holds the code that runs local processes for the
  server. `processes/login-helper/` (S3.2) is the sign-in helper: `port.ts` (the
  `LoginHelper` port: one official CLI login in a throwaway sandbox, its output, input, home files and kill), `docker.ts`
  (development: a locked-down container of the image built from `deploy/Dockerfile.login`), `local.ts` (a Linux server
  with the CLIs: a private temporary home), `process.ts` and `tty.ts` (the child process plumbing and the pseudo-terminal
  command both share, with node's `spawn` injected so tests use a fake child) and `select.ts` (`loginHelperFromConfig`:
  MWC_LOGIN_HELPER, which `createApp` hands the credentials module's sign-in routes unless a test passes a fake).
  `processes/power/local.ts` (S4) is the server's own power driver (MWC_LOCAL_POWER): it finds this computer's
  `airia` and `gcloud`, wires the `@mwc/machine-airia-devbox` connector and the shared tunnel supervisor with node's
  `spawn` injected, and `start.ts` hands it to the machines module's power control (`machinesRuntime` in `app.ts`).
  `processes/docker/` is this computer's Docker CLI (MWC_LOCAL_DOCKER): `local.ts` finds `docker` without starting a
  process and gives each command a short environment, `run.ts` runs one to its end in its own process group (its
  output lines, a time limit), with node's `spawn` injected; `createApp` hands it to the machines module, which rebuilds
  container runners with it (`service/runner/rebuild.ts`).
  `processes/speech/` (S5.2, docs/speech.md) is dictation's transcription on the server's own computer: `wav.ts` (the
  clip's checks and its voice), `transcript.ts` (whisper.cpp's two JSON answers as text and words), `server.ts` (the warm
  `whisper-server` on 127.0.0.1, started on the first clip, stopped on shutdown), `cli.ts` (`whisper-cli` on a temporary
  file, the fallback), `whisper.ts` (`createWhisper`, the `Speech` the speech module calls) and `select.ts`
  (`speechFromConfig`: MWC_WHISPER, the binaries and the model found without starting anything), with node's `spawn` and
  `fetch` injected; `createApp` builds it unless a test passes a fake, and the speech module's one route uses it.
  `jobs/outbox.ts` (S1.5) is the identity outbox:
  `enqueueOutbox(t, entry)` in the caller's transaction, `processOutboxRow(deps, row, handler)` recording a
  handler's outcome on the row (done, or pending with `attempts`, `last_error` and `next_attempt_at`, failed after
  its last try, or at once for an `OutboxGiveUpError`: a refusal no retry fixes), and what a handler starts with
  (`outboxProvider`, `outboxTenant`: the configured provider, the row's company or none once deleted; `isLastAttempt`);
  the modules own the handlers (`companies`: `create_org`, `delete_org`; `members`: `update_role`, `remove_member`,
  `invite`, `revoke_invite`). The jobs loop (S1.10) is the rest of `jobs/`: `runner.ts` (`createJobsRunner`, which
  `start.ts` starts with MWC_JOBS=on: one timer at a time, so ticks never overlap, with injectable timers; `stop()`, in
  the graceful shutdown, waits for the tick in flight and gives the lock up), `lock.ts` (one runner per database: a
  Postgres advisory lock on a session of its own, `reserveSession` of `@mwc/db/system`), `run.ts` (`runJobsOnce`: the
  outbox, the webhook event retry and the periodic reconcile, each caught and logged; idle without a provider),
  `outbox-drain.ts` (the due rows claimed in small batches with a lease under `for update skip locked`, each run with
  its op's handler from one registry, `outboxRegistry`), `reconcile.ts` (every active company linked to an organization
  about once per MWC_RECONCILE_MINUTES, each in its own slot, from `companies.reconciled_at`) and `status.ts` (what
  `/readyz` shows of it). The modules' work reaches the loop through `moduleJobs(deps)` in `app.ts`, the one place that
  composes it, so no module imports the loop and the loop imports no module. `jobs/retry.ts` (S1.8) is the retry policy
  the outbox and the webhook inbox share (30 s doubling to 1 h, given up after 12 tries; `describeFailure` for
  `last_error`). The identity module's `service/sync.ts` (S1.7) holds two of the three acceptance paths:
  `projectIdentityEvent` (one normalized webhook event, projected with its audit rows in one transaction) and
  `reconcileCompany` (a company against its organization, S1.10's periodic reconcile and
  `POST /api/companies/:companyId/sync`); the third is `GET /api/me` (`service/me.ts`, split from `service.ts` in S1.12, which re-exports it), which
  `POST /api/me/reconcile` (S1.12) runs again on the person's request, once per person every 10 s. Every path writes the audit
  rows of what it changed, by the system: a webhook event with its delivery id, a reconcile with the id of the request that
  ran it (none for the periodic one). The webhook inbox (S1.8) is the same module:
  `POST /api/webhooks/clerk` in its `routes.ts`, `service/webhooks.ts` (verify, record once, process inline),
  `service/events.ts` (`processInboxEvent`, and `retryIdentityEvents` for S1.10's loop), and its raw database access
  in `repo/events.ts` (the `identity_events` rows, claimed under `for update skip locked`) and `repo/audit.ts` (a
  projection's audit rows), under the identity repo's Biome exemption. A membership that turns active or stops being
  active moves its person on the org chart in its own transaction (S2.4): the database store's `upsertMembership`
  (`repo/memberships.ts`) and the members module's removal call the org module's `memberChart`
  (`org/service/lifecycle.ts`), which `createApp` and `moduleJobs` in `app.ts` pass them as `ChartDeps`, a port the
  identity module defines (`repo/chart.ts`), so neither module imports the org module. Later `realtime/`.
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
  database (`createTestApp()` from `@mwc/testkit`). A scenario, a story across modules over the whole HTTP API with no
  source file to mirror, lives in `test/scenarios/` (S1.12: `s1-acceptance.test.ts`, the S1 acceptance), its helpers in
  `test/fixtures/<scenario>/` (`test/fixtures/acceptance/`). The other helpers are grouped by the module or
  platform part they serve (`test/fixtures/identity/`, `members/`, `companies/`, `credentials/`, `platform/`).

## Connectors and ports

An outside system (Clerk, another identity provider, Claude Code, Codex, Jira, GitHub, the AI gateway)
is reached only through a connector in `connectors/<name>/`, which implements a port defined in a
`packages/*-core` package (`IdentityProvider` in `@mwc/identity-core`, `HarnessDriver` in `@mwc/harness-core`, whose
connectors only the runner loads: the server reads the wire contracts of `@mwc/shared/harness`). Connectors are wired
in `apps/server/src/app.ts` (or the runner's equivalent);
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
`packages/cli/src/mwc.ts`, `packages/mcp/src/main.ts`, `apps/runner/src/main.ts`; `scripts/` are outside `src/`) and
`apps/web/**`.

## The web (`apps/web`)

React 19, Vite and Tailwind 4: `src/main.tsx` (the entry), `src/app/` (the boot from `GET /api/config`, the Clerk
root, the routes, the small router `router.tsx`, the session gate over `GET /api/me`, the shells and the company
context), `src/pages/` (one file per page; `pages/auth/` for sign-in, sign-up, the invitation and the not-configured
page, `pages/company/` for the pages under `/:slug`, `pages/design/` the development-only gallery), `src/components/`
(the library, grouped by role, each group with a barrel: `ui/` the shared primitives: button, panel, notice, loading
states, badges and status pills, avatars, tooltips; `forms/` fields (the secret field among them), selects, menus,
segmented controls, inline confirmation and inline rename; `data/` tables, lists, stat tiles, the meter and the steps;
`feed/`, `layout/` (the shells, the drawer and the sheet), `auth/`; `org/` the org chart's tree, node card and manager
select (S2.5)), `src/features/` (one page area's own parts each, moved out of `components/` in the S3 review:
`members/`, `api-keys/`, `settings/`, `company/`, `overview/`, `agents/`, `subscriptions/` (S3.5: the Subscriptions
page's tabs and cards, the add sheet with its sign-in and paste flows, and the home page's Subscription limits
widget)), `src/api/` (the typed client `hc<AppType>`, `call()` and the error
messages, the response types inferred from the routes, the `useLoad` hook, the API and configuration contexts, the
org hooks and calls `org.ts`, and the person's own subscriptions, limits and access profiles `subscriptions.ts`),
`src/styles/` (the Tailwind theme and base
styles). A hook used by one component stays in its file. Source files keep the 300-line limit and components
stay under about 60 lines (rows, panels and hooks of their own). No frontend tests for now (no UI unit tests, no
browser smoke): `mwc check` typechecks it in every lane and `--full` builds it.

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

The company row itself is a global row, reached through the tenant layer too (S1.5): `t.updateCompany(set, where?)`
updates only the tenant's company (never its id), and `t.lockCompany()` reads it `for update` inside
`t.transaction()` and refuses it once deleted. A new company is `withNewCompany(db, { name, slugs, ... }, work)`:
one transaction inserts the company (`provisioning`) with the first free slug of the list (`on conflict do
nothing`, so a slug taken by a concurrent create moves on instead of aborting) and runs `work` on a `TenantDb`
bound to it, so the company and its first tenant rows (the owner's principal and membership, the outbox call, the
audit rows) commit together or not at all; no slug free rejects with `SlugTakenError`. This is how a module writes
a global row and tenant rows in one transaction without `@mwc/db/system`. `auditChanges(t, entry)` writes the
per-field audit rows of `diffFields` in the tenant's company, and `isUniqueViolation(error, constraint?)` tells a
taken value (a 409) from a failure on both drivers.

Personal data, a person's own rows that belong to no company (S3.1: `credentials`, `credential_uses`, which have
`owner_user_id` and no company of their own; since S5.1b a use names the company, agent, chat and principal a chat's
turn or terminal opened it for, as plain ids with no foreign keys), is reached the same way through `owned(db, userId)` of `@mwc/db`: its `OwnedDb`
scopes every statement to that person (reads, updates and deletes get `owner_user_id = …`, inserts get it stamped)
and writes their audit rows with no company (`o.audit(entry)`). It is neither tenant data nor raw access, so a module
uses it without an exemption; the user id is the signed-in caller's (`c.var.userId` of a personal route) or the owner a
server-side use names. S3.4's `access_profiles` is personal too, and company rows point at it (`agents.profile_id`,
`memberships.default_claude_profile_id` and `default_openai_profile_id`), so `@mwc/db` bridges the two layers in one transaction: `ownedIn(t, userId)` (a
person's layer on a tenant's connection), `ownersOf(t, table, ids)` (whose personal rows these are, nothing more; the
rows are then read through their owner's layer) and `o.tenant(companyId)` (a company's tenant on a person's
connection). The org module reads the profiles its agents point at this way (since S7.1b also its tool parts' sign-ins,
their account details only); the credentials module asks the org
module's service for the agents using a profile and for the audit rows its removal leaves. The chats module (S5.1b)
reads the profile a turn runs on the same way and opens its subscriptions through the credentials module's service
(`credentialsForHarness`). Its one raw access is `modules/chats/repo/reaper.ts` (in the Biome exemption, as the
machines' `repo/upkeep.ts`): at the server's start it fails every company's turns a stopped server left running. The
notifications module's (S2.9) is `modules/notifications/repo/delivery.ts`, in the same exemption: the jobs loop finds the
people whose email is due in any company, then reads and marks each batch through that company's tenant. The tasks
module's (S6c) is `modules/tasks/repo/wakes-due.ts`, in the same exemption: the Lead wake-up tick stamps the new wake
events and finds the flows whose window passed (and the sign-offs waiting too long) in any company, then reads, tells and
marks each flow's events through that company's tenant. The credentials module's (S7.1a) is
`modules/credentials/repo/checks-due.ts`, in the same exemption: the jobs loop finds the tool sign-ins due for their
daily check across every person, then opens, checks and changes each through its owner's personal layer. The
integrations module's (2026-11-13) is `modules/integrations/repo/slack-inbound-all.ts`, in the same exemption: the
server's Slack connections find every bot sign-in whose receiving is on, then read and change each through its owner's
personal layer.

Raw, unscoped access (`createDb`, `migrateToLatest`, `queryRows`, `rawDb(handle)`, and `tenantOf(rawDb, companyId)`,
a tenant on a raw database or an open transaction) is `@mwc/db/system`, for the
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
| `big-folder`    | a folder has more than 12 direct entries, files and folders (generated folders are skipped); the folders that grow by design have their own limit, `folderEntriesFor`: 20 for each folder of `apps/web/src/components/`, for `apps/web/src/api/`, `packages/db/src/schema/`, `packages/shared/src/` and `packages/shared/test/`; a test folder that mirrors a source folder (`<pkg>/test/<path>/` for `<pkg>/src/<path>/`) gets that source folder's limit, so `packages/db/test/schema/` gets 20 |
| `fan-in`        | 8 or more files of the same package import a file by a relative path for its values (importers outside `test/`; type-only imports and exports do not count; the files of one server module, `fanInGroups`, count as one; the files meant to be imported everywhere, `fanInExempt`: the web's `components/`, `api/` and `app/`, the server's `apps/server/src/platform/http/` (errors, docs, router) and `packages/db/src/schema/` (columns, tenant, principals: designed building blocks), are never listed) |
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
