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
| `packages/shared` | config, ports, ids, enums, the identity contracts (unit) | none |
| `packages/identity-core` | the fake provider (tokens, CRUD and errors, events, `failNext`, webhooks), the projector rule by rule, reconcile, the scenario (`src/scenario.ts`) and the in-memory store's seeding and snapshot; convergence and the reconcile paths are cases of the store contract (testkit) | none (`InMemoryIdentityStore`) |
| `packages/cli` | argument parsing, `mwc check` and `mwc dev` plans with fake processes, package discovery, the banned-names scanner and the commit-msg hook's command, each structure rule on an in-memory tree (violations, a clean tree, the exemptions) and on this repository, the early warnings and the function-length heuristic on in-memory trees and texts, two short real-process checks of the spawn wrapper | none |
| `packages/db` | schema constraints (`test/schema/`: every CHECK enum, unique and partial unique index, the composite tenant keys refusing another company's rows, the tenant conventions on every tenant table), migrations (a database at `0000_init` with rows taken to `0001_identity`), `migrationStatus`, `queryRows`, `tenant()` (scoping, stamping, transactions, a missing, deleted or malformed company refused), the system entry and the Biome rule that keeps it out of server modules (one Biome run on a scratch tree), the schema diagram, test database names, the Postgres paths of `createTestDb` against a fake server, and the stale-database sweep | `createTestDb()`: PGlite, or Postgres with `TEST_DB=postgres` |
| `packages/testkit` | its own helpers (capture logger, fixed clock, JSON requests, `createTestApp`, `seedCompany`, the identity re-exports, svix signing), the provider contract against `FakeIdentityProvider` (and once more with a target that cannot accept invitations, so the skip path is exercised), the store contract against `InMemoryIdentityStore` with the full counts, and a guard that the workspace's dependency graph has no cycle except the dev-only testkit ↔ server one | `createTestApp()`, `createTestDb()` |
| `connectors/identity-clerk` | mirrors `src/` against a fake Clerk backend (no network): every port method, the error and rate-limit mapping, paging; the real `verifyToken` of `@clerk/backend` on tokens signed with a local RSA key (issuer, `azp`, expiry, 5 s skew, foreign keys); the real `verifyWebhook` on svix-signed deliveries (good, replayed, bad, stale and future signatures, a signed non-JSON body) and every Clerk payload mapping. `test/contract.test.ts`: the provider contract against the real development instance, only with `CLERK_CONTRACT_TEST=1` (below) | none |
| `apps/server` | mirrors `src/`: the app's wiring (request ids, clock), `platform/http` through `app.request()` (request log, errors, OpenAPI and docs, static UI), `platform/` (logger, graceful shutdown, version, `start` with injected database, server and signals, plus one real `serve()` on a free port), `modules/health` (`/healthz`, `/readyz`, `/api/version`), `modules/identity` (the database `IdentityStore` under the store contract, fewer convergence runs, plus its principals, provider identities and one-transaction projection; target in `test/fixtures/identity-store.ts`), `dev/memory-server` | `createTestApp()` on `createTestDb()`; `start` on PGlite |
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
| `FakeIdentityProvider`, `InMemoryIdentityStore` | the in-memory identity provider (`fake:<subject>[;org=<id>][;pending]` tokens, `accept()`, `drainEvents()`, `failNext()`, `webhookFor()`) and identity store, from `@mwc/identity-core` (its README) |
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
and find it by metadata, refuse a taken slug, list the creator as an admin-like member, refuse an unknown
organization, create an invitation (metadata, role, 14-day expiry), refuse a duplicate, list by status, revoke
(idempotently), accept (the invitation's private metadata must reach the membership), promote, remove,
verify a webhook, delete the organization. Each case builds on the earlier ones. A target
(`ContractTarget`) adds what the port does not have: people signing up, session tokens, the invitee's
acceptance (which may answer `unverified` with a reason: the case is then skipped with that note), signed
webhooks and the cleanup, which runs even after a failure.

It runs against `FakeIdentityProvider` in every lane, and against the real Clerk development instance only on
request: `pnpm --filter @mwc/identity-clerk contract` (`docs/clerk-setup.md`, which also says what a run
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

## Running one piece

```sh
pnpm exec vitest run --project server                 # one package's tests on PGlite (also: testkit, db, ...)
pnpm exec vitest run apps/server/test/modules/health/routes.test.ts   # one file
pnpm mwc dev                                          # or just the dev Postgres: docker compose -f deploy/compose.yml up -d --wait postgres
TEST_DB=postgres TEST_DATABASE_URL=postgres://mwc:mwc@localhost:9952/mwc pnpm exec vitest run
```

Keep tests cheap to run: the Mac bills every process start, so tests drive code in-process
(`app.request()`, injected spawn/exec fakes) and start real processes only where the process itself is
what is being tested.
