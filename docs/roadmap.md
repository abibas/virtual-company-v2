# Roadmap

Stages of the rebuild, each a sprint that ends in a tagged release and a review with Ihor. Extracted from `plan-2026-11-03.md`; tick items off here as they land.

## 1. Context

Ihor (2026-11-03) wants to stop growing v1 and re-implement the product from scratch, stage by stage, reviewing each stage and covering it with unit tests, so the result is clean, cloud-deployable as a container stack, and multi-tenant-ready. The new project lives in `/Users/abibas/PERSONAL/Most_Wanted_corp_v2` (created empty today) on ports 9950–9999 (verified free). This supersedes the v2 epic parked in v1's task tracker (it named another folder and ports 4100–4199; the PM updates it when v2 starts).

What v1 is (reference only; never written to):
- **v1, first application** (frozen since 2026-10-08): plain JS, Express 5, node:sqlite, Clerk login without webhooks, AES-256-GCM credential store, hardened Docker agent runtime, permission-prompt relay (`--permission-prompt-tool stdio`), 94 node tests, ~10k lines. A real second-user invitation was never tested.
- **v1, second application** (our changes on top of a large third-party application): about 56k lines of ours on a ~1M-line base (259 tables); the core hooks sit in two 19k–31k-line base files; almost no tests for our logic. Remote execution on the Airia devbox = SSH over IAP + detached `setsid` runs + `sleep` placeholders + a hand-made reverse tunnel for MCP callbacks + a file-queue bridge for API calls. Recorded pain: server restarts kill runs, lease deadlocks, a shared MCP config moved the wrong task, Mac sleep lapsed leases, Stop did not reach the remote process, the box's `settings.json` overrode the run's gateway env.
- Prior spec worth reusing: v1's product roadmap (entities, lifecycle, P0–P5) and its architecture notes.

**First goal for v2:** one configured remote coding agent ("SLOP BOX", a single coder role) that Ihor's main Claude Code chat (CEO office) can message, and whose "needs input" / "blocked" states reach his inbox. Everything else grows from that, in the order below.

## 15. Stage plan (each stage = one sprint ending in a tagged release and a review with Ihor)

### S0 — skeleton and one-command start

Done when: fresh clone → `pnpm i && pnpm dev` serves the web on 9951 against the API on 9950 and compose Postgres on 9952; `docker compose -f deploy/compose.yml up` does the same on 9990–9992; `mwc check` is green; `CLAUDE.md` loads in an agent session in that folder.
1. Workspace scaffold (pnpm, tsconfig base, Biome, `.nvmrc`, `.env.example`, zod `loadConfig()`) — test: config rejects a missing `DATABASE_URL`. **Done 2026-11-03.**
2. `@mwc/db`: drizzle config, `0000_init.sql` (`companies`, `users`, `audit_log`), `migrateToLatest()` — test: migrates on PGlite; a second run is a no-op. **Done 2026-11-03.** S0.2b: the generated schema diagram `docs/schema.md` (Mermaid ER diagram + a section per table), drift-checked by `mwc check`. **Done 2026-11-03.**
3. `@mwc/server`: `createApp(deps)`, `/healthz`, `/readyz` (DB ping + migrations current), `/api/openapi.json`, `/api/docs`, request id + pino — tests: readyz 503 before migrate, 200 after. **Done 2026-11-03.**
4. `@mwc/web`: Vite/React/Tailwind shell with the design tokens from the shared UI library's `theme.css` — Playwright: page loads, shows the API version. **Done 2026-11-03** (the Playwright smoke was removed in S1.0a: no frontend tests for now).
5. Compose (postgres, migrate, server, runner placeholder) + `mwc dev` orchestrator + `docs/ports.md`. **Done 2026-11-03** (`deploy/compose.yml` = dev Postgres, `deploy/compose.prod.yml` = the prod-like stack, `deploy/Dockerfile.server`, `mwc dev`, the `--full` lane on Postgres, `docs/testing.md`).
6. `@mwc/testkit` v0 + `mwc check` + pre-push hook + coverage thresholds. **Done 2026-11-03** (`mwc check`, the pre-push hook and the coverage thresholds landed with S0.1–S0.5; S0.6 adds `@mwc/testkit`, the stale test database sweep of the Postgres lane, `mwc` on plain Node without tsx, and the journal read once for `/readyz`).
7. `CLAUDE.md` (v1 is read-only reference, ports, no secrets, no pushes, tenant id everywhere, tests per ticket), `README.md`, `docs/architecture.md` (this plan's sections 4–13), `docs/roadmap.md`. **Done 2026-11-03** (written with S0.1 and kept current by every step since; no separate commit).

**S0 release notes (v0.1.0, `36ce2a3..v0.1.0`, S0.1–S0.6):**
- pnpm workspace on Node 24 and TypeScript 7 with no build step (Node runs the sources), Biome, Vitest with coverage thresholds (80% lines/statements/functions, 70% branches), the zod config loader and the 9950–9999 port map with worktree slots.
- `@mwc/db`: Drizzle schema v0 (`users`, `companies`, `audit_log`), the `0000_init` migration, `migrateToLatest`, `migrationStatus`, a migrations and schema-diagram drift check, the generated `docs/schema.md`.
- `@mwc/server`: Hono with `/healthz`, `/readyz` (database ping and migrations current), `/api/version`, the OpenAPI 3.1 document and Swagger UI, request ids, pino logs, one error shape, graceful shutdown, the built UI served in production.
- `@mwc/web`: React 19, Vite and Tailwind 4 with the shared UI tokens, the typed Hono client, and a Playwright smoke in the installed Chrome.
- Containers: `deploy/compose.yml` (dev Postgres on 9952), `deploy/compose.prod.yml` (server image, one-shot migrate and its own Postgres on 9990/9992; the plan's "compose up on 9990–9992"), `deploy/Dockerfile.server`.
- `mwc` (plain Node): `check` (fast, default and `--full` lanes: tests again on the dev Postgres, web build, e2e), `dev` (Postgres, migrations, API and web in one command), `ports`; the pre-push hook runs `mwc check --fast`.
- `@mwc/testkit`: `createTestApp`, `createTestDb` (PGlite or Postgres, leftovers swept), `fixedClock`, JSON request helpers, a capture logger.

### S1 — identity and companies

Before S1.2 (2026-11-04, Ihor's approved layout): **S1.0a** the repository in the layout of `docs/structure.md`
(tests in each package's `test/`, the server's `platform/` and `modules/`, `main.ts` a 3-line entry over the tested
`platform/start.ts`, the in-memory demo server in `dev/`, a `connectors/` group, coverage in `.cache/`, raised
coverage floors, no frontend tests for now: the Playwright smoke and its port 9957 are gone). **S1.0b** the
structure step of `mwc check` (layout, package contents, tests only in `test/`, 300/500-line limits, module
files and imports; `packages/cli/src/structure/`), with the oversized files split (the identity projector and
fake provider, the schema diagram, `mwc`'s dispatch, two identity test files). **S1.0c** the project skill
`keep-structure` (`.claude/skills/keep-structure/`): where code goes, the module, package and connector
checklists, the database routine, file size discipline; the structure step's failures point at it. **S1.0d**
the structure keeps improving: `pnpm mwc structure --report` lists early warnings (files near their limit,
long functions, big folders, high fan-in, the weakest coverage) and `mwc check` ends with their summary; the
lessons log (`references/lessons.md`); a structure review at the end of every stage (its last item below);
and the `docs` rule, which fails when `docs/structure.md` or the skill falls behind `rules.ts`.

Frontend tests are off for now (Ihor, 2026-11-04): the stage items below that name a Playwright smoke or an e2e
scenario get one only when he turns them back on; until then those steps are checked by hand at the stage review.

Done when: Ihor signs in, creates a company, invites a second real person who accepts via the emailed link, who appears active as member, is promoted to admin, is removed and loses access immediately; all of it with webhooks off and again with ngrok on; the e2e scenario is green.
1. identity-core: interfaces, normalized events, `FakeIdentityProvider`, projector — unit: duplicate and out-of-order events converge. **Done 2026-11-04** (`@mwc/identity-core`: the `IdentityProvider` and `IdentityStore` ports, `IdentityProviderError`, the zod contracts in `@mwc/shared/identity`, the order-safe projector, `reconcileOrganization`/`reconcileUser`, `FakeIdentityProvider` and `InMemoryIdentityStore`, re-exported by `@mwc/testkit`; rules in `packages/identity-core/README.md`).
2. `connectors/identity-clerk` (`@mwc/identity-clerk`): `verifyAccessToken`, Backend API wrapper, `parseWebhook`, `roleMap` — unit with a fake client; svix signature tests; the opt-in real-Clerk contract test run once against the dev app (also verifies the instance settings in `docs/clerk-setup.md`). **Done 2026-11-04** (`@mwc/identity-clerk` on `@clerk/backend` 3.26.5: `ClerkIdentityProvider` with every port method, Clerk, HTTP and network errors mapped to `IdentityProviderError`, 429 with `Retry-After` honored and Clerk's 250 invitations an hour kept in a sliding window, the role map (owner and admin → `org:admin`, member and viewer → `org:member`; `org:admin` reads back as admin, never owner), `parseWebhook` verifying svix with Clerk's `verifyWebhook` and mapping `user.*`, `organization.*`, `organizationMembership.*`, `organizationInvitation.accepted|revoked` with `updated_at` as the ordering guard; unit tests through a fake Clerk backend, the real `verifyToken` on tokens signed with a local RSA key and the real `verifyWebhook` on deliveries signed with a test svix secret; the provider contract in `@mwc/testkit/provider-contract` (16 cases), run against `FakeIdentityProvider` in every check; `docs/clerk-setup.md`; port 9993 reserved for the visible test browser's debugging port). **Real-Clerk contract run: pending.** The secret key was not in place yet when the step was committed, so nothing has been verified against the development instance: not the settings, not the invitation metadata on the membership. Run it with `pnpm --filter @mwc/identity-clerk contract` once `CLERK_SECRET_KEY` is set (`docs/clerk-setup.md`, "The contract test").
3. Migration `0001_identity` (users, user_identities, companies columns, principals, memberships, invitations, identity_events, identity_outbox, api_keys) + `tenant()` layer + lint rule — integration: composite-FK rejection; `tenant()` 404 on a deleted company. **Done 2026-11-04** (`0001_identity`: `user_identities` (UNIQUE issuer+subject; `users.primary_email` is no longer unique), `principals`, `memberships` (role, granted role, provider role, status, provider membership, invitation; one per company and user, its own person principal), `invitations` (one pending per email and company, a partial unique index), `api_keys` (SHA-256 hash, runner keys bound to a machine), `identity_events` (the inbox, UNIQUE provider+delivery id), `identity_outbox` (op, idempotency key, retries), `identity_marks` and `identity_parked_events` (the projector's bookkeeping); every tenant table `UNIQUE(company_id, id)` with composite child keys, `audit_log`'s actor included; enums as CHECKs from `@mwc/shared/enums`. `tenant(db, companyId)` in `@mwc/db` (scoped reads, updates and deletes, stamped inserts, transactions; `CompanyNotFoundError` for a missing, deleted or malformed company); raw access only through `@mwc/db/system` (`DbHandle` hides the Drizzle object), which Biome forbids in server modules except the identity repo (`biome.json`, proven by `packages/db/test/system.test.ts`). The database `IdentityStore` (`apps/server/src/modules/identity/repo.ts`) passes the new IdentityStore contract (`@mwc/testkit/store-contract`: the port, convergence of the identity scenario, now `@mwc/identity-core/scenario`, and reconcile) like the in-memory store; `seedCompany` in the testkit.)
4. `authn()` + `requireMembership()` + `GET /api/me` with reconcile-on-sign-in — tests: pending `sts`, wrong issuer, wrong `azp`, expired, API key, revoked key. **Done 2026-11-04** (`apps/server/src/platform/auth/`: `authn()` turns `Authorization: Bearer` into an `Actor` (`kind`, `via` clerk|api_key|run_token, user, principal, company, session) from a session token verified by the identity provider against `MWC_WEB_ORIGIN` (issuer checked again here, `sts=pending` refused with 403 `session_pending` everywhere but `/api/me`, the person found by `(issuer, subject)` in `user_identities`, never by email) or a personal API key (`mwc_pk_` + 32 base62, found by its SHA-256, revoked, expired and unknown keys refused, `last_used_at` written at most once a minute; runner and SCIM keys refused until S3 and later; run tokens a typed slot refused until S4), 401 `unauthenticated` with a Bearer challenge otherwise; `requireMembership(role)` reads our `memberships` through `tenant()`, 404 for a missing or deleted company and a non-member alike, 403 below the role (owner > admin > member > viewer, `@mwc/shared/roles`), and puts `c.var.tenant` and `c.var.membership` on the context; the error handler maps `CompanyNotFoundError` to 404 and a provider that is down to 503 `identity_unavailable`. `GET /api/me` (`modules/identity`, in the OpenAPI document with the `bearer` scheme): the user, their memberships that are not removed in companies that are not deleted, and the session's pending flag; reconcile on sign-in with `reconcileUser` on the database store the first time a person is seen, when their link is missing, or once per new session, retried on a unique violation so concurrent first calls converge. Config: `MWC_IDENTITY` (clerk when `CLERK_SECRET_KEY` is set, else none: identity routes answer 503 `identity_not_configured`, health and the UI stay up), `MWC_WEB_ORIGIN` (web dev 9951 or the slot's web port, the public URL in production), the Clerk keys; the connector is wired in `platform/identity.ts`. The fake provider's tokens gained `sid`, `iss`, `azp`, `exp` and `nbf` parts, checked like Clerk's claims, and `fake.ts` was split (organizations, invitations, tokens). Tests through `app.request()` with the fake: valid, pending, wrong issuer, wrong `azp`, expired, garbage, no header, API keys ok/revoked/expired/unknown/wrong prefix, the role matrix and its 404s, reconcile creating the person and linking the accepted invitation, a second call reading only, concurrent first calls in one server and in two, and `MWC_IDENTITY=none`.)
5. Companies: create (outbox `create_org`), list mine, get, patch, soft delete with name confirmation — test: a retry after a provider failure creates no second org. **Done 2026-11-04** (`apps/server/src/modules/companies/`: `POST /api/companies {name, slug?}` writes in one transaction the company (`provisioning`), the creator's person principal and active owner membership, the outbox `create_org` row (idempotency key `create_org:<companyId>`, the creator's subject in its payload) and per-field audit rows; a slug left out is derived from the name (accents dropped, lower-case kebab, at most 63 characters, `company` when nothing is left) and tried with `-2` … `-10` and three random suffixes when taken, a chosen slug that is taken is a 409; only a person signed in with a session and linked here may create (an API key 403 `forbidden`, a person not linked yet 403 `user_not_linked`), under `MWC_COMPANY_CREATION=any|allowlist|none` (`any` by default, `allowlist` in production) with `MWC_COMPANY_CREATORS` (emails); `GET /api/companies` lists my companies with my role, exactly the companies `GET /api/me` lists (through the identity service, `companiesOf`); `GET /api/companies/:companyId` member and above; `PATCH` admin and above, one audit row per changed field with the actor's principal and the request id, 409 `slug_taken`; `DELETE {confirmName}` owner only, 422 `confirmation_mismatch`, a soft delete (`status = deleted`, `deleted_at`) with the outbox `delete_org` row (the organization id when there is one) and audit rows, after which `tenant()` makes the company a 404 for everyone. The outbox handlers (`service/organizations.ts`, for the S1.10 loop): `create_org` looks the organization up by `mwc_company_id` first and creates it only when there is none (without the slug when the provider's is taken), then links the company and turns it active (audit rows by the system); `delete_org` deletes the recorded organization or the one found by metadata, an organization already gone counting as success. `platform/jobs/outbox.ts`: `enqueueOutbox` in the caller's transaction and `processOutboxRow`, which marks a row done or leaves it pending with `attempts`, `last_error` and `next_attempt_at` (30 s doubling to 1 h, or a longer Retry-After), `failed` after 12 tries. `@mwc/db`: `withNewCompany(db, input, work)` (the company row and its first tenant rows in one transaction, the first free slug by `on conflict do nothing`), `TenantDb.updateCompany` and `lockCompany`, `auditChanges`, `isUniqueViolation`; `companyMember(deps, role)` types a zod-openapi route's middleware. Tests through `app.request()` with the fake: every route's happy path, 401, 403 for the wrong role, 404 across companies and 400/422, the policy modes, slug derivation and collisions, audit rows field by field, the soft delete hiding the company, and the handlers: the happy path, a failure after the provider created the organization then a retry with still one organization, a failure before it acted, an organization found by metadata, a company deleted before or while the handler ran, and `delete_org` by id, by metadata, with none, already gone and failing once.)
6. Memberships: list, patch role (last-owner guard), remove (reports move up, keys revoked) — per-field audit rows asserted.
7. Invitations: create/resend/revoke; outbox worker; projection via webhook, sign-in reconcile, periodic reconcile, manual sync — tests cover all three paths, expiry, revoked-then-accepted.
8. `POST /api/webhooks/clerk`: raw body, verify, dedupe, process, retry — tests: replay, bad signature 400.
9. Personal API keys: create/list/revoke; `mwc login`, `mwc whoami`.
10. Jobs loop (outbox, reconcile, event retry; single runner via advisory lock; `MWC_JOBS=on`).
11. Web: sign-in, onboarding, `/c/:slug` switcher, Members page, `/accept-invitation`.
12. E2E: owner → invite a `+clerk_test` user → second browser context accepts → member visible → promote → remove → 403.
13. **Structure review** (`.claude/skills/keep-structure/references/review.md`): `pnpm mwc structure --report` and the open lessons, then at most 5 improvements, each with its evidence, to Ihor before the tag; each one he approves lands as its own commit.

### S2 — org structure

Done when: a chart with people and agents can be built, moved and read as a tree; invalid moves are refused with reasons; a removed person's reports are re-parented; SLOP BOX exists as an agent definition (coder role, Opus, effort xhigh, instructions) reporting to Ihor.
1. Migration `0002_org`: agents, org_positions (+ reserved `credentials`, `machines` DDL, no API yet); zod contracts for S3–S5 tables in `@mwc/shared`.
2. Org rules (`apps/server/src/modules/org/rules.ts`): `validateMove`, `nearestPersonUp`, `directReports`, `descendants` — unit: cycles, agent root, agent managing a person, chain not reaching a person.
3. API: agents CRUD (name, slug, role_title, harness, model, effort, instructions, max_concurrent_runs), `PUT /org/positions/:principalId`, `GET /org/chart` — integration incl. cross-tenant and viewer-forbidden.
4. Lifecycle hooks: membership activate → position under the inviter; remove → re-parent; agent archive → re-parent.
5. Web: org chart page, agent form, person title edit.
6. CLI/MCP thin: `mwc org tree`, `mwc agents list`; `@mwc/mcp` exposing `me`, `org_chart`, `agents_list`.
7. **Structure review** (`.claude/skills/keep-structure/references/review.md`): `pnpm mwc structure --report` and the open lessons, then at most 5 improvements, each with its evidence, to Ihor before the tag; each one he approves lands as its own commit.

### S3 — machines and runner

Done when: a runner installed on Ihor's Mac as a launchd service and the compose `runner-local` both show online on the Machines page, survive a server restart, go offline on disconnect and come back; a signed runner update installs itself when idle.
1. `runner-protocol.ts` + testkit fake server / fake runner — unit: zod round-trips, protocol fixtures.
2. Enrollment tokens + `api_keys(kind=runner)` + WS hub (hello, heartbeat, resync, ack, key.rotate) — integration on PGlite with `ws`: connect, `last_seen_at` moves, disconnect marks offline.
3. `apps/runner` core (config, state dir, unix socket, health :9953, reconnect/backoff, awake time) — runner vs fake server: survives a server restart.
4. `mwc runner install` (launchd / systemd / container) + `mwc machine enroll-token` + Machines page — unit: plist/unit rendering; Playwright: machines page.
5. Self-update + drain + `runner_releases` — test with a signed tarball.
6. **Structure review** (`.claude/skills/keep-structure/references/review.md`): `pnpm mwc structure --report` and the open lessons, then at most 5 improvements, each with its evidence, to Ihor before the tag; each one he approves lands as its own commit.

### S4 — tasks, threads, runs

Done when: a message to a task assigned to an agent starts a run on its machine, events stream to the thread, the reply is posted; a second message resumes the same session id; Stop works; `kill -9` of the runner and a server restart mid-turn both recover; the chaos scripts pass with the fake `claude`.
1. `HarnessDriver` (`packages/harness-core`) + `connectors/harness-claude-code` `buildSpawn`/`parseLine` + fake `claude` binary and fixtures (also records the real permission-tool round trip once with the installed CLI).
2. Run folder, detached spawn, journal, re-attach, stop ladder — runner integration with the fake `claude`.
3. Server: tables, state machine, scheduler, reaper, `run_inputs`, `task_sessions`, SSE, `agent_placements` — API integration.
4. UI thread + run status + `mwc task create|send|tail|stop` — Playwright smoke sends a message and sees the reply.
5. **Structure review** (`.claude/skills/keep-structure/references/review.md`): `pnpm mwc structure --report` and the open lessons, then at most 5 improvements, each with its evidence, to Ihor before the tag; each one he approves lands as its own commit.

### S5 — inbox, attention, CEO chat tooling  ← **the SLOP BOX milestone**

Done when the demo below passes on the Mac and then on the devbox:
1. MCP shim + runner tool server (`ask_user`, `permission`, `report_blocked`, `submit_for_review`, `post_message`, `read_task`), per-run `mcp.json` — tests: shim ↔ socket, schemas, fake `claude` calling tools.
2. `attention_items` service: routing, CAS resolve, expiry, both wait modes, answer → tool result or next turn — integration per kind.
3. Inbox UI + `mwc inbox list|answer|watch|count` + `@mwc/mcp` tools (`send_message`, `read_thread`, `task_status`, `inbox_list`, `inbox_answer`); a Claude Code status-line recipe for `mwc inbox count`.
4. **Demo:** SLOP BOX placed on the Mac first (home folder with its CLAUDE.md and skills, its own `CLAUDE_CONFIG_DIR`, policy `bypass`, worktree root), then on the devbox (`mwc runner install` once over the existing IAP SSH, `systemd --user` + linger). Ihor's Claude Code sends a message through `@mwc/mcp`; SLOP BOX works, calls `ask_user`; the item appears in the inbox and in `mwc inbox watch`; he answers with `mwc inbox answer`; the run continues (live if within 90 s, otherwise as a resumed turn) and reports done; a `report_blocked` variant lands in the inbox as blocked. Recorded against the real CLI; replayed in Playwright with the fake `claude`.
5. **Structure review** (`.claude/skills/keep-structure/references/review.md`): `pnpm mwc structure --report` and the open lessons, then at most 5 improvements, each with its evidence, to Ihor before the tag; each one he approves lands as its own commit.

### S6 — credentials and sign-ins

Done when: the compose runner runs a task with a server-held Claude setup-token and no credentials on disk; GitHub and Jira sign-ins are stored encrypted per person and granted per agent; deliveries are audited.
1. `credentials` store (v1's AES-256-GCM credential store bound to owner and provider, ported, plus key versioning and the company in the AAD) + API — unit: tamper detection, wrong tenant.
2. Claude setup-token flow in a throwaway container (PTY capture, as in v1), stored encrypted — integration with a fake container runner.
3. GitHub `gh auth login --device`, Jira `acli` sign-in (v1 flows), per-agent grants, delivery in `run.start.secrets`, `credential_deliveries` audit.
4. **Structure review** (`.claude/skills/keep-structure/references/review.md`): `pnpm mwc structure --report` and the open lessons, then at most 5 improvements, each with its evidence, to Ihor before the tag; each one he approves lands as its own commit.

### S7 — work model from v1 (one ticket each, behind the same tests discipline)

Review flows (ordered review/approval stages; only a person moves a task to Done), sprints tied to releases, Jira intake read-only via the person's sign-in, PR watch, per-task worktrees, agent chat per agent, AI gateway routing per run and per machine, machine power schedule for the devbox, Codex driver. Each item names the v1 behaviour it replaces and ships with integration tests.

Last item: **Structure review** (`.claude/skills/keep-structure/references/review.md`): `pnpm mwc structure --report` and the open lessons, then at most 5 improvements, each with its evidence, to Ihor before the tag; each one he approves lands as its own commit.

### S8 — cloud deployment

Hardened compose for a VM (TLS via a reverse proxy, backups with `pg_dump` and restore drill, log rotation), then k8s manifests (migrate Job, server Deployment + Ingress, runner pool), secrets through the platform's secret store, a staging instance, runbooks. Done when a staging stack on a cloud VM runs the S5 demo with a container runner and a laptop runner at the same time.

Last item: **Structure review** (`.claude/skills/keep-structure/references/review.md`): `pnpm mwc structure --report` and the open lessons, then at most 5 improvements, each with its evidence, to Ihor before the tag; each one he approves lands as its own commit.

## 19. Verification

- Per ticket: its unit/integration tests in `mwc check`; the stage's e2e smoke in `mwc check --full`; a short demo to Ihor at the end of each stage (he reviews stage by stage, as requested).
- S1 acceptance is a real second human accepting an invitation (never done in v1).
- S4 acceptance includes the chaos scripts (server kill mid-turn, runner `kill -9` mid-turn, 3-minute runner pause) with the fake `claude`.
- S5 acceptance is the SLOP BOX demo script in section 15 (Mac, then devbox), recorded with the real CLI and replayed in Playwright.
- S8 acceptance is the same demo on a cloud VM with one container runner and one laptop runner.

## 20. Execution model and first steps

- **Who executes (recommended):** the CEO office (this chat) writes `docs/architecture.md` and scaffolds S0 with Ihor watching, so the conventions (tenant layer, testkit, `mwc check`) exist before anyone else codes; from S1 the CORP product PM gets the stage tickets one at a time (as today), the Developer builds in worktrees with the port triplets, the PM closes deployed work; Ihor reviews each stage. The v2 epic parked in v1's task tracker is rewritten by the PM from this plan (folder `Most_Wanted_corp_v2`, ports 9950–9999, stages S0–S8) on Ihor's go. Alternative: the CEO office executes S0–S2 directly and hands over at S3. Either way, runs and task assignments start only on his request.
- **First commits:** S0.1–S0.7 above, then S1.2's real-Clerk contract test (the earliest external-dependency check), then S4.1's fake-`claude` fixtures recorded from the installed CLI (the earliest harness check).
- **Not touched:** v1 (both applications, their databases, the devbox, his sign-ins) stays as is; v1 keeps running the current teams while v2 grows on 9950–9999.
