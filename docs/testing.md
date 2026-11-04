# Testing

Every change ships with tests and `pnpm mwc check` green before it is committed. Tests live in each
package's `test/`, mirroring `src/` (`src/a/b.ts` → `test/a/b.test.ts`, shared helpers in
`test/fixtures/`; `docs/structure.md`). There are no frontend tests for now (Ihor, 2026-11-04: no UI
unit tests and no browser smoke); the web is typechecked in every lane and built in `--full`.

## Lanes

| Lane | Command | What runs | When |
| --- | --- | --- | --- |
| fast | `pnpm mwc check --fast` | Biome, banned names, structure (`docs/structure.md`), `tsc --noEmit` per workspace package (`packages/*`, `connectors/*`, `apps/*`), db drift (migrations and `docs/schema.md`), all Vitest tests on PGlite, no coverage | the git pre-push hook |
| default | `pnpm mwc check` | the fast lane with coverage (v8; overall 90% lines/statements/functions and 85% branches, every file 85% lines and 75% branches; reports in `.cache/coverage/`) | before every commit |
| full | `pnpm mwc check --full` | the default lane, then the tests again on the dev Postgres and the web build | before a push that touches the database, the server or the web, and at the end of a stage |

**Banned names** (in every lane, in-process, one `git ls-files`): every file git tracks or would track
(untracked files that are not ignored count too), except `pnpm-lock.yaml` and binary files, is scanned
case-insensitively for the terms in `packages/cli/src/banned.ts`, names from earlier versions of the
product that never appear in this repository; a hit fails the check with `file:line`. The terms are built
from parts in that file, so the list never contains them. The `commit-msg` hook
(`.githooks/commit-msg`, `mwc banned --message <file>`) applies the same list to each commit message
(without git's `#` comment lines and the `git commit -v` diff). `pnpm mwc banned` runs the file scan alone.

**Structure** (in every lane, in-process, on the same file listing as the banned names): the layout rules
of `docs/structure.md`, from `packages/cli/src/structure/rules.ts`: known top-level entries, packages only
in `apps/`, `packages/` and `connectors/` with their required files, tests only in `test/`, the size limits
(300 lines of source, 500 of tests), the server's module files and imports, and that `docs/structure.md`
and the keep-structure skill still say what `rules.ts` holds. A failure is `path[:line]: [rule] reason`.
`pnpm mwc structure` runs it alone. Every lane ends with a short summary of the early warnings
(`pnpm mwc structure --report`, `docs/structure.md`), which never changes the exit code.

`--full` in order:

1. `postgres` starts the dev Postgres (`deploy/compose.yml`, 127.0.0.1:9952) and waits for its
   healthcheck, unless it is already running (then it is left as it is, e.g. under `pnpm dev`).
   Without Docker the Postgres steps are skipped and the check says so.
2. `tests on postgres` runs Vitest with `TEST_DB=postgres` and
   `TEST_DATABASE_URL=postgres://mwc:mwc@localhost:9952/mwc`, with coverage in `.cache/coverage/postgres/`.
   Each db and server test database is then a new database `mwc_test_<time>_<random>` on that
   server, reached through `createDb` (postgres.js) and dropped when the test closes it
   (`@mwc/db/testing`), so the postgres.js paths of `createDb`, `migrateToLatest`, `migrationStatus`
   and `queryRows` run against a real Postgres 17 and the dev database `mwc` is never touched. All
   projects run (Vitest 5 reports no coverage when `--project` filters them); the cli and shared tests
   ignore `TEST_DB`.
   **Leftovers:** a run that is killed (Ctrl-C, a crash) cannot drop its databases, so the first
   `createTestDb()` of every test process sweeps first (`dropStaleTestDbs`): it drops the `mwc_test_*`
   databases whose name says they are older than 1 hour (`<time>` is the creation time in ms, base 36)
   and that have no connection. The drop runs without `FORCE`, so a database somebody connects to in the
   meantime is refused by Postgres and kept; names that do not have the test-database shape are never
   touched. The sweep runs against the real server in this lane only (`packages/db/test/testing.test.ts`);
   its code paths also run in every lane against a fake server (`createTestDb(env, server)`).
3. `web build`: `vite build` of `apps/web` into `apps/web/dist`.
4. `postgres down` stops the dev Postgres again if step 1 started it (the volume stays).

## Where the tests are

| Package | Tests | Database |
| --- | --- | --- |
| `packages/shared` | config (also `MWC_JOBS` on by default and off with `NODE_ENV=test`, `MWC_RECONCILE_MINUTES`; `MWC_IDENTITY` clerk only for a well-formed secret key, `CLERK_SECRET_KEY_PATTERN`), ports, ids, enums, the role order and the web's role helpers (`grantableRoles`, `mayRemove`), the identity contracts and an invitation's status as of now, the API key format and display prefix (unit) | none |
| `packages/identity-core` | the fake provider (tokens, CRUD and errors, events, `failNext`, webhooks, an unused type as an `ignored` event), the projector rule by rule, reconcile, the scenario (`src/scenario.ts`) and the in-memory store's seeding and snapshot; convergence and the reconcile paths are cases of the store contract (testkit) | none (`InMemoryIdentityStore`) |
| `packages/cli` | argument parsing, `mwc check` and `mwc dev` plans with fake processes (the API's `--env-file-if-exists` flags for `.env` and `.env.local`, only the file names printed), package discovery, the banned-names scanner and the commit-msg hook's command, each structure rule on an in-memory tree (violations, a clean tree, the exemptions) and on this repository, the early warnings and the function-length heuristic on in-memory trees and texts, two short real-process checks of the spawn wrapper; `mwc login`, `whoami` and `logout` in-process with a fake fetch answering `GET /api/me` per key and a temporary `MWC_CONFIG_DIR` (never `~/.config`): the key from the environment, a pipe and a hidden terminal prompt (`test/fixtures/account.ts`), a wrong company, a 401, the key refused as an argument; the credentials file's modes (0600 in 0700), its atomic replacement and a failed rename leaving the old file, the precedence of `MWC_SERVER` and `MWC_API_KEY` | none (a temporary folder) |
| `packages/db` | schema constraints (`test/schema/`: every CHECK enum, unique and partial unique index, the composite tenant keys refusing another company's rows, the tenant conventions on every tenant table), migrations (a database at `0000_init` with rows taken to the latest migration), the inbox's `ignored` type, `migrationStatus`, `queryRows`, `reserveSession` (one session per reservation holding its advisory lock; on Postgres two sessions excluding each other, on PGlite the one session, and the postgres.js path against a fake pool in every lane), `isUniqueViolation` on a real violation, `tenant()` (scoping, stamping, transactions, a missing, deleted or malformed company refused, the company row updated and locked, `withNewCompany` with the first free slug and its rollback, `tenantOf` inside a raw transaction), `auditChanges`, the system entry and the Biome rule that keeps it out of server modules (one Biome run on a scratch tree), the schema diagram, test database names, the Postgres paths of `createTestDb` against a fake server, and the stale-database sweep | `createTestDb()`: PGlite, or Postgres with `TEST_DB=postgres` |
| `packages/testkit` | its own helpers (capture logger, fixed clock, JSON requests, `createTestApp`, `seedCompany`, the identity re-exports, svix signing), the provider contract against `FakeIdentityProvider` (and once more with a target that cannot accept invitations, so the skip path is exercised), the store contract against `InMemoryIdentityStore` with the full counts, and a guard that the workspace's dependency graph has no cycle except the dev-only testkit ↔ server one | `createTestApp()`, `createTestDb()` |
| `connectors/identity-clerk` | mirrors `src/` against a fake Clerk backend (no network): every port method, the error and rate-limit mapping, paging; the real `verifyToken` of `@clerk/backend` on tokens signed with a local RSA key (issuer, `azp`, expiry, 5 s skew, foreign keys); the real `verifyWebhook` on svix-signed deliveries (good, replayed, bad, stale and future signatures, a signed non-JSON body, an unused type as `ignored`) and every Clerk payload mapping; the `webhooks` capability only with a signing secret. `test/contract.test.ts`: the provider contract against the real development instance, only with `CLERK_CONTRACT_TEST=1` (below) | none |
| `apps/server` | mirrors `src/`: the app's wiring (request ids, clock), `platform/http` through `app.request()` (request log, errors, OpenAPI and docs, static UI), `platform/` (logger, graceful shutdown, version, `start` with injected database, server and signals (and its warning, by name only, for a malformed Clerk secret key), plus one real `serve()` on a free port), `platform/auth` (`authn()` with session tokens, API keys and run tokens, key generation and its unbiased base62, `requireMembership()` with the role matrix and its 404s, through probe routes from `test/fixtures/auth.ts` that only tests mount), `platform/identity` (the Clerk connector wired from the configuration), `modules/health` (`/healthz`, `/readyz`, `/api/version`, `/api/config`: sign-in off, Clerk's publishable key and never a secret, the web origin and API URL, uncached, in the API docs), `modules/identity` (`GET /api/me` with reconcile on sign-in, concurrent first calls in one server and in two; `POST /api/me/reconcile`, `test/modules/identity/routes/reconcile.test.ts`: an invitation accepted while signed in brought in at once, one turn per person every 10 s with `Retry-After` (`platform/http/throttle.ts` on its own), a pending session, an API key refused, the provider away, sign-in off, the OpenAPI entry; the audit rows of the sign-in reconcile, the self reconcile, Sync now and the periodic reconcile, by the system with the request's id; the database `IdentityStore` under the store contract, fewer convergence runs, plus its principals, provider identities and one-transaction projection; target in `test/fixtures/identity-store.ts`; acceptance on sign-in, also after an expiry; `POST .../sync` with its 401, 403, 404 and 503; `service/sync.ts`: the webhook path and the company reconcile, each ending with the invitee active, an acceptance after the expiry, a revoke that crossed the acceptance, events out of order and repeated, another email, a removed member invited again, the revocation of a copy a resend replaced; the webhook inbox, `POST /api/webhooks/clerk`: `test/modules/identity/routes/webhooks.test.ts` with the real Clerk connector's `parseWebhook` on svix-signed deliveries (`@mwc/testkit/webhooks`): processed, a replay that does nothing, a bad or missing signature, another secret, a stale or future timestamp, a tampered body, a non-JSON or ill-fitting body and an oversized one refused with nothing recorded, an unused type recorded as `ignored`, 503 without a signing secret or a provider, a provider failure, the OpenAPI entry; `service/webhooks.test.ts` with the fake's deliveries: an invitation accepted ending with the member active in `GET .../members`, out-of-order, replayed and redelivered events converging, a deleted person, membership or company never coming back, and the audit rows of an activation, an accepted invitation, a provider role change and a removal; `service/events.test.ts`: a processing failure recorded `failed` with its backoff and retried, the give-up after 12 tries, the audit rows rolled back with the projection, a stranded pending row taken after its lease, the batch limit and two passes at once; `repo/events.test.ts` and `repo/audit.test.ts` on the rows; processing failures come from a `check (false) not valid` constraint added for the test, `failWrites` in `test/fixtures/webhooks.ts`), `modules/companies` (every route's happy path, 401, 403 for the wrong role, 404 across companies and 400/422, the creation policy modes, slug derivation and collisions, audit rows field by field, the soft delete; the `create_org` and `delete_org` handlers, with a provider answer lost after it acted, `loseNextAnswer` in `test/fixtures/companies.ts`), `modules/members` (the list, every route's 401, 403, 404 across companies and for unknown memberships, and 400; the full role matrix of role changes and removals, the no-op, the last-owner guard on demote, remove and leave, concurrent demotions and departures of the last two owners, access lost at once by session and API key, revoked keys, audit rows field by field, the outbox rows; the `update_role` and `remove_member` handlers, run out of order, after a failure, a lost answer, a member already gone and an organization not created yet; the pure role rules, and `@mwc/shared/roles`' web helpers held to them for every role combination; helpers in `test/fixtures/members.ts`; invitations: every route's 401, 403, 404 and 400, who may invite whom, `already_member`, `invitation_pending` and a concurrent pair, the list filters as of now, resend and revoke with their audit and outbox rows; the `invite` and `revoke_invite` handlers with a lost answer, a provider failure, an organization not created yet, an invitation revoked, expired or accepted first, the give-up and the last try, resends; `remove_member` for a refused provider membership; helpers in `test/fixtures/invitations.ts`), `modules/api-keys` (create with the secret shown once and only its SHA-256 and prefix stored, the key on `/api/me` and on company routes in its own company only, the expiry bounds, a key caller refused, my keys against `?all=1` for admins and owners, revoke own and another's, the no-op, 403, 404 across companies, the revoked key's 401, the audit rows, and the secret and hash absent from every other response, the audit rows and the logs; helpers in `test/fixtures/api-keys.ts`), `platform/jobs` (the outbox: enqueueing, done, retry, failed, give-up, skipped, the handlers' provider and tenant; the shared retry policy, `retry.ts`: the backoff and `last_error`; the jobs loop of S1.10 with timers fired by hand (`manualTimers`) and a clock a day ahead of the database's `now()` (`jobsWorld`, both in `test/fixtures/jobs.ts`): `run.test.ts`, `runJobsOnce` on the fake provider taking a company from creation to an invitation accepted at the provider with nothing but ticks, every outbox op through the one registry, a webhook event retried, the order of the jobs, a failing job isolated, idle without a provider; `outbox-drain.test.ts`, the claim, its lease and batch, two passes at once, backoff, give-up and an op with no handler; `reconcile.test.ts`, the slots (the SQL held to the TypeScript), due and not due, the spread over an interval, skipped companies, failures; `lock.test.ts`, the advisory lock taken, lost and given up, and in `--full` two pools excluding each other; `runner.test.ts`, ticks without overlap, the lock waited for, lost and failing, stop waiting for the tick and its timeout, and in `--full` two runners on one Postgres where only the holder runs; `status.test.ts`, the outbox backlog; `/readyz`'s `jobs` block in `modules/health`, the loop in `start` and the shutdown order), `dev/memory-server`; and the S1 acceptance scenario, `test/scenarios/` (below) | `createTestApp()` on `createTestDb()`; `start` on PGlite |
| `apps/web` | none for now | — |

## The test kit (`@mwc/testkit`)

One import for what tests need; add `"@mwc/testkit": "workspace:*"` to the package's `devDependencies`.

| Helper | What |
| --- | --- |
| `createTestApp(options?)` | `{ app, db, logger, logs, close }`: `createApp` of `@mwc/server` on a fresh test database, migrated, with a silent capture logger (`logs` holds every line, parsed), `TEST_VERSION` and `testConfig`. Options are anything `createApp` takes (`db`, `clock`, `webDist`, `journal`, `logger`) plus `migrate: false`; a `db` passed in is used as is and not closed. |
| `createTestDb()`, `testDbKind()`, `pgError(query)` | test databases (PGlite, or Postgres with `TEST_DB=postgres`) and the SQLSTATE/constraint behind a rejected query; the implementation lives in `@mwc/db/testing`, which the db package's own tests import directly |
| `fixedClock(at = TEST_NOW)` | a `() => Date` that stands still until `clock.advance(ms)` or `clock.set(at)`; pass it as `createTestApp({ clock })` |
| `getJson(app, path, headers?)`, `postJson(app, path, body, headers?)`, `requestJson(app, method, path, { body, headers })` | one in-process request, returning `{ status, body, headers }` with the body parsed |
| `captureLogger()`, `LEVEL` | a pino logger that keeps its lines in an array, and pino's numeric levels |
| `brokenDb('reject' \| 'hang')` | a handle whose queries fail or never answer, as if Postgres were down |
| `FakeIdentityProvider`, `InMemoryIdentityStore` | the in-memory identity provider (`fake:<subject>[;org=<id>][;pending]` tokens, with optional `sid`, `iss`, `azp`, `exp` and `nbf` parts checked like Clerk's claims, `accept()`, `drainEvents()`, `failNext()`, `webhookFor()`) and identity store, from `@mwc/identity-core` (its README) |
| `describeProviderContract(name, makeTarget, { timeoutMs })`, `fakeContractTarget()`, `PROVIDER_CONTRACT` | the `IdentityProvider` contract as a Vitest suite for one target (below); also `@mwc/testkit/provider-contract`, which loads without the server |
| `signedWebhook(payload, secret, { id, timestamp })`, `testWebhookSecret()`, `svixSignature(...)` | a svix-signed delivery (`svix-id`, `svix-timestamp`, `svix-signature`) as Clerk sends it, signed independently of Clerk's SDK; also `@mwc/testkit/webhooks` |
| `describeStoreContract(name, makeTarget, { shuffles, doubles, orders, timeoutMs })`, `memoryStoreTarget()`, `STORE_CONTRACT` | the `IdentityStore` contract as a Vitest suite for one store (below); also `@mwc/testkit/store-contract`, which loads without the server |
| `seedCompany(db, { slug, name, status, identityOrgId, owner })` | an active company with its owner (user, identity at the fake's issuer, person principal, owner membership), the tenant rows through `tenant()`; returns `{ company, owner, tenant }` |

```ts
import { createTestApp, fixedClock, getJson, type TestApp } from '@mwc/testkit';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ clock: fixedClock() });
});
afterAll(() => t.close());

it('is ready', async () => {
  expect(await getJson(t.app, '/readyz')).toMatchObject({ status: 200, body: { status: 'ready' } });
});
```

The testkit depends on `@mwc/server` and the server's tests use the testkit: a dev-only cycle, harmless
without build steps. `pnpm-workspace.yaml` sets `ignoreWorkspaceCycles` so pnpm does not warn about it
on every install, and `packages/testkit/test/workspace.test.ts` fails on any other cycle or if the testkit
ever becomes a production dependency. S1.1 added `FakeIdentityProvider` and `InMemoryIdentityStore` here,
S1.2 the provider contract and `signedWebhook`, S1.3 the store contract and `seedCompany`.

## Provider contract

`PROVIDER_CONTRACT` (`packages/testkit/src/provider-contract.ts`) is one scenario of 16 cases that every
`IdentityProvider` passes in the same way: describe itself, get a user, verify a token, create an organization
and find it by metadata, refuse a taken slug (only a provider with `capabilities.organizationSlugs`; skipped on Clerk,
whose connector sends no slug), list the creator as an admin-like member, refuse an unknown organization, create an
invitation (metadata, role, 14-day expiry), replace it with a second one to the same email (the first turns revoked, as
Clerk does), list by status, revoke (idempotently), accept (the invitation's private metadata must reach the membership,
and the member's email is refused for another invitation), promote, remove, verify a webhook, delete the organization.
Each case builds on the earlier ones. A target
(`ContractTarget`) adds what the port does not have: people signing up, session tokens, the invitee's
acceptance (which may answer `unverified` with a reason: the case is then skipped with that note), signed
webhooks and the cleanup, which runs even after a failure.

It runs against `FakeIdentityProvider` in every lane (three times: as it is, without organization slugs like the Clerk
connector; with `organizationSlugs: true`, so the slug case runs; and with a target that cannot accept), and against the
real Clerk development instance only on request: `pnpm --filter @mwc/identity-clerk contract` (`docs/clerk-setup.md`, which also says what a run
creates and how it cleans up).

## Store contract

`STORE_CONTRACT` (`packages/testkit/src/store-contract.ts`) is what every `IdentityStore` passes in the same way,
15 independent cases, each on `target.fresh()`:

- the port, method by method: users by `(issuer, subject)` (another issuer is another person, even with the same
  email), companies and their organization link, memberships by `(company, user)` and their lists, invitations
  and their patches (an unknown id rejects), marks, parked events (once per key, whole, oldest first); a
  malformed id finds nothing;
- convergence of the identity scenario (`@mwc/identity-core/scenario`, 41 events, a person per projector rule):
  in order it ends with each rule applied and exactly where the in-memory store ends, marks included; seeded
  shuffles, double deliveries and a second application change nothing; orders of one person's six events all end
  the same;
- reconcile: the provider history replayed with reconciles instead of webhooks ends where the webhooks end.

A target (`StoreContractTarget`) adds what the port does not have: seeding companies, users, memberships and
invitations, and a snapshot in the in-memory store's shape. The in-memory store runs it with the full counts
(200 shuffles, 25 double deliveries, all 720 orders); the database store (`apps/server`) with 8, 3 and 24, on
PGlite and in `--full` on Postgres, emptying its tables for each run.

## S1 acceptance

The S1 acceptance (`docs/roadmap.md`, S1.12) in code: `apps/server/test/scenarios/s1-acceptance.test.ts`, one story over
the real HTTP API (`app.request()`), with the fake provider and the jobs loop's real tick (`runJobsOnce`; the clock is a
fixed one, a day ahead of the database's `now()` and moved by hand). Frontend tests are off, so it stands in for plan item
12's Playwright e2e until Ihor turns them back on. It runs once per acceptance path (`describe.each`), each on a fresh
database: PGlite in every lane, Postgres in `--full`. Its steps share their state in order, so a failing step names the
first thing that broke.

| Step | What is checked |
| --- | --- |
| 1 | Ihor signs in: `GET /api/me` links him with no companies; `POST /api/companies` answers `provisioning`; a tick creates the organization at the provider (found again by `mwc_company_id`) and the company is `active` |
| 2 | he invites `second+clerk_test@example.com` as a member; a tick sends the invitation at the provider with `mwc_invitation_id`, `mwc_company_id` and the member role, and the list shows it sent |
| 3 | the second person accepts at the provider (a sign-up with the ticket) and the server learns it by the path under test; they are `active` as a member in `GET .../members`, the invitation is `accepted` by them, and their `GET /api/me` lists the company |
| 4 | as a member they read the company and its members, and get 403 on invite, rename, Sync now and the invitation list |
| 5 | Ihor makes them an admin; a tick pushes `update_role` to the provider (the provider's admin role); they invite someone (201) |
| 6 | they make a personal API key (shown once); `GET /api/me` with it, what `mwc whoami` asks, answers as them, admin, in that company only |
| 7 | Ihor removes them: at once their session gets 404 on the company (and `GET /api/me` lists it no more) and their key 401; the provider still has them until the next tick's `remove_member` |
| 8 | every change made through the API has audit rows of its entity and action with the actor's principal and the request id (`x-request-id`, one per labelled request); the company's provisioning and the acceptance are the system's |
| 9 | a third company someone else owns answers 404 to the owner, the second person and the API key on every route tried and is in none of their lists, and theirs answers 404 to its owner (after steps 1, 3, 6 and 7) |

The paths of step 3: `webhook` (the fake's signed deliveries posted to `POST /api/webhooks/clerk`; the session works before
the person's first `GET /api/me`), `first sign-in` (their first `GET /api/me`), `periodic reconcile` (neither: a tick once the
clock reaches the company's next slot), `sync now` (an admin's `POST .../sync`) and `signed in already` (a person signed in
before accepting, whose `GET /api/me` in that session does not reconcile again: `POST /api/me/reconcile` brings the company
in, a second call within 10 s is a 429 with `Retry-After: 10`, and one after it a 200).

The helpers are in `apps/server/test/fixtures/acceptance/`: `target.ts` (the provider as a target: people who sign up and
stay signed in, an invitee who signs up with the ticket; the fake), `world.ts` (the app, the clock, the tick, requests with
request ids), `steps.ts` (steps 1 to 7, shared with the real-Clerk run), `paths.ts` (step 3's paths on the fake),
`checks.ts` (steps 8 and 9) and `clerk.ts` (the real development instance as a target). Scenario tests live in
`test/scenarios/` because a story across modules has no source file to mirror (`docs/structure.md`).

```sh
pnpm exec vitest run apps/server/test/scenarios/s1-acceptance.test.ts
```

**Real Clerk, on request.** `apps/server/test/scenarios/s1-acceptance-clerk.test.ts` runs steps 1, 2, 3 by the first
sign-in, and 7 against the Clerk development instance. It reuses the connector's contract fixtures
(`connectors/identity-clerk/test/fixtures/clerk-target.ts` and `fapi.ts`, loaded only when it runs): the owner is made through
the Backend API and signs in on the Frontend API with a sign-in token, the invitee signs up with the invitation's ticket, both
with `mwc-contract-<random>-<label>+clerk_test@example.com` emails (no email is sent), and their session tokens carry
`http://localhost:9951` as `azp`, which the test app is configured with. Everything the run made is deleted afterwards, also
when a step fails. It needs `CLERK_CONTRACT_TEST=1` and a development secret key; otherwise it reports one skipped test and
makes no call:

```sh
# Is the secret key in place? Prints only yes or no.
node --env-file-if-exists=.env --env-file-if-exists=.env.local \
  -e 'console.log(/^sk_test_[A-Za-z0-9]{20,}$/.test(process.env.CLERK_SECRET_KEY ?? "") ? "yes" : "no")'

pnpm --filter @mwc/server acceptance:clerk
```

It has not run yet (the key was not in place on 2026-11-04). What stays with Ihor's walkthrough at the stage review: a real
second person accepting by the emailed link, the ngrok webhook hookup (`docs/clerk-setup.md`, "Webhooks"), and the browser
click-through of the same story (sign-in, Members, API keys, `/accept-invitation`).

## Running one piece

```sh
pnpm exec vitest run --project server                 # one package's tests on PGlite (also: testkit, db, ...)
pnpm exec vitest run apps/server/test/modules/health/routes.test.ts   # one file
pnpm mwc dev                                          # or just the dev Postgres: docker compose -f deploy/compose.yml up -d --wait postgres
TEST_DB=postgres TEST_DATABASE_URL=postgres://mwc:mwc@localhost:9952/mwc pnpm exec vitest run
```

The `db`, `server` and `testkit` projects allow 20 s per test instead of Vitest's 5 s: some of their tests open a
fresh database inside the test body, and a PGlite cold start plus every migration can take longer than 5 s when the
whole workspace runs in parallel with coverage.

Keep tests cheap to run: the Mac bills every process start, so tests drive code in-process
(`app.request()`, injected spawn/exec fakes) and start real processes only where the process itself is
what is being tested.
