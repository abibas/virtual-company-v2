# Lessons

This log records where the structure did not fit and what was done about it. Read the `open` entries before
deciding where code goes. The structure review ([review.md](review.md)) brings them to Ihor and marks them
`adopted` or `declined`. Write down facts only: the commits, files and line counts that show what happened.

## When to add an entry

- The placement table in SKILL.md did not cover your case.
- A rule forced an awkward placement.
- A split went badly: a cycle, an entry file that stayed near the limit, tests that would not move cleanly.
- A warning of `pnpm mwc structure --report` kept coming back.

## Format

Newest first, one entry per lesson:

```md
### YYYY-MM-DD: a short title

- **What happened:** the facts, with line counts where they matter.
- **Where:** paths and commits.
- **What was done:** the fix, or "nothing yet".
- **Suggested change:** to a rule (`packages/cli/src/structure/rules.ts`) or to the placement table, or "none".
- **Status:** `open`, `adopted` (when, in which commit) or `declined` (why).
```

## Entries

### 2026-11-04: Every company module's routes import the platform's error helpers

- **What happened:** S1.6's members routes need `errorJson` (a service refusal as the common error body) and
  `errorResponse` (an error response in the OpenAPI document), like every route file before them, so
  `apps/server/src/platform/http/errors.ts` went from 7 importers to 8 and became a `fan-in` warning (the report went
  from 17 to 18). Its importers are `app.ts`, `platform/auth/authn.ts`, `platform/auth/membership.ts`,
  `platform/http/router.ts`, `modules/identity/routes.ts`, `modules/companies/routes/collection.ts`,
  `modules/companies/routes/company.ts` and `modules/members/routes.ts`. `platform/http/router.ts` (6 importers) and
  `docs.ts` (5) follow the same curve: each new company module adds one or two route files. A second warning, on
  `platform/auth/actor.ts` (9 importers, all for its types), was avoided by narrowing the members services to the acting
  membership's id, which they read again under the company's lock anyway.
- **Where:** `apps/server/src/modules/members/routes.ts` (S1.6). The same step moved the company route base S1.5 had in
  `modules/companies/routes/company.ts` to `platform/auth/membership.ts` (`companyRoute`), since members needed the same
  one, and the outbox handlers' `providerOf` / `openTenant` from `modules/companies/service/organizations.ts` to
  `platform/jobs/outbox.ts` (`outboxProvider`, `outboxTenant`).
- **What was done:** kept the direct import. A barrel or a facade that re-exports `errorJson` would move the count to
  another file without changing who depends on the error contract.
- **Suggested change:** in `packages/cli/src/structure/warnings.ts`, count a module's files as one importer (fan-in
  across areas, not files), or list the platform files that are meant to be every module's API (`platform/env.ts`,
  `platform/http/errors.ts`, `docs.ts`, `router.ts`, `platform/auth/actor.ts`) in `rules.ts` and leave them out of
  `fan-in`. Either keeps the warning for files whose fan-in is a surprise.
- **Status:** `open`.

### 2026-11-04: A module that reads across the caller's companies

- **What happened:** S1.5's `GET /api/companies` lists the caller's companies, and the creation policy reads the
  creator's primary email. Both read across companies or global tables (`memberships` of one user everywhere,
  `users`), which a company's `TenantDb` cannot do, and the companies module may not import `@mwc/db/system`. The
  placement table only knows "SQL through `tenant(db, companyId)`".
- **Where:** `apps/server/src/modules/companies/service.ts` (`listCompanies`, `policyRefusal`) calling
  `apps/server/src/modules/identity/service.ts` (`companiesOf`, `profileOf`; 139 to 147 lines), whose repo has the raw
  access exemption; S1.5.
- **What was done:** the companies module calls the identity module's service, which reads through its exempted
  repo, so `GET /api/companies` lists exactly what `GET /api/me` lists, from one query. No new Biome exemption.
- **Suggested change:** a placement-table row: "A read across the caller's companies, or of a person's own profile
  → the identity module's service (`companiesOf`, `profileOf`), never a new raw-access exemption."
- **Status:** `open`.

### 2026-11-04: The module template's routes grew into a long function and an untyped context

- **What happened:** S1.5 followed the template's `routes.ts`: every `createRoute` inside the router factory and
  `middleware: [authn(deps), requireMembership(deps, role)]`. With five routes the factory was 116 lines (the
  report's `long-function`), and the array literal did not type `c.var.tenant` or `c.var.membership` (zod-openapi
  reads the middleware's environment from a tuple only), so the handlers did not typecheck. The route tests in one
  file reached 430 lines (`near-limit`). A shared route base with `path` typed as `string` also collapsed the web's
  typed client (`apps/web/src/api/client.ts` failed to typecheck).
- **Where:** `apps/server/src/modules/companies/routes.ts` (14 lines now), `routes/collection.ts` (60),
  `routes/company.ts` (104), tests mirrored in `test/modules/companies/routes/` (243 and 210 lines);
  `platform/auth/membership.ts` (`companyMember`); `platform/http/docs.ts` (`jsonBody`, `jsonResponse`) and
  `platform/http/errors.ts` (`errorResponse`); S1.5. The service factory had the same `long-function` (137 lines)
  and became named functions (`createCompany`, `updateCompany`, `removeCompany`, ...) bound by a short factory.
- **What was done:** route configs are factories outside the router function, the routes are grouped by path in
  `routes/` and mounted by `routes.ts` with `.route('/', ...)`, `companyMember(deps, role)` returns the tuple, the
  shared path is `as const`; the module template now shows this pattern. The report stayed at 17 warnings.
- **Suggested change:** confirm the template's new `routes.ts` example; consider a placement-table note that a
  module's routes become `routes/<path group>.ts` once they pass about three routes.
- **Status:** `open`.

### 2026-11-04: Splitting the near-limit fake moved its warning to fan-in

- **What happened:** S1.4 needed the fake identity provider to check token claims (`iss`, `azp`, `exp`, `nbf`, and a
  `sid`), so server tests refuse a wrong issuer, a wrong origin and an expired token for real. `fake.ts` had been at
  290 of 300 lines since S1.0b (the report's `near-limit`). It was split by concern: token verification to
  `fake/tokens.ts` (22 → 95 lines), organizations to `fake/organizations.ts` (44), invitations to
  `fake/invitations.ts` (73); `fake.ts` went from 290 to 230 lines, and its tests moved along the same seams (25
  tests before and after). Each new part implements a port method and takes the port's own input type
  (`CreateOrganizationInput`, `CreateInvitationInput`, `VerifyTokenContext`), so `provider.ts` went from 7 importers
  to 10 and became a `fan-in` warning. The report stayed at 17 warnings in all, but one kind turned into another.
- **Where:** `packages/identity-core/src/fake.ts`, `src/fake/`, `test/fake/` (S1.4).
- **What was done:** kept the type imports; copying the port's types into each part to stay under the threshold
  would have been worse.
- **Suggested change:** in `packages/cli/src/structure/warnings.ts`, count only value imports for `fan-in` (or skip
  `import type`). A port module such as `provider.ts` or `store.ts` is meant to be imported for its types.
- **Status:** `open`.

### 2026-11-04: Test-only routes for a platform guard

- **What happened:** `requireMembership(role)` (S1.4) guards `/api/companies/:companyId/...`, but the first real
  company route arrives with S1.5. The placement table has no row for a route that only tests need.
- **Where:** `apps/server/test/fixtures/auth.ts` (`mountProbe`, `authWorld`), used by `test/platform/auth/*.test.ts`.
- **What was done:** the probe routes (`GET /api/companies/:companyId/probe/<role>`, `authn()` then
  `requireMembership(role)`) live in the test fixture and are mounted on `createTestApp().app` after `createApp`,
  as `test/app.test.ts` already mounts `/test/clock`. Production wiring has none.
- **Suggested change:** a placement-table row: "A route only tests need (a probe for platform middleware) →
  the package's `test/fixtures/`, mounted on the test app; never in `src/`."
- **Status:** `open`.

### 2026-11-04: A cross-tenant store has no row in the placement table

- **What happened:** S1.3 needed a database `IdentityStore`. The placement table sends SQL to
  `modules/<area>/repo.ts` "through `tenant(db, companyId)`", but the projector reads across companies (a
  person's memberships everywhere, an invitation found by its id alone, companies by organization id) and
  writes global tables (`users`, `user_identities`, `identity_marks`, `identity_parked_events`), so no single
  company's tenant fits. The table has no row for a store that must see every company.
- **Where:** `apps/server/src/modules/identity/repo.ts` (117 lines) and `repo/` (users 68, memberships 95,
  invitations 53, bookkeeping 37 lines); the exemption in `biome.json`; S1.3. S1.4 added `repo/me.ts` (67 lines),
  the reads of `GET /api/me` across a person's companies, under the same exemption.
- **What was done:** the store sits where the map puts the identity area, as its `repo.ts` with a `repo/` folder,
  and reads the raw database (`@mwc/db/system`). `biome.json` forbids that entry in `apps/server/src/modules/**`
  and turns the rule off for exactly `modules/identity/repo.ts` and `modules/identity/repo/**`;
  `packages/db/test/system.test.ts` proves both. `docs/structure.md` ("The tenant layer") says so.
- **Suggested change:** a placement-table row: "A store that must see every company (the identity store, later
  the runner hub) → `modules/<area>/repo.ts` with raw access, listed in the `biome.json` exemption", or move such
  stores to `platform/` if Ihor prefers modules to hold tenant code only.
- **Status:** `open`.

### 2026-11-04: The testkit barrel loads the whole server

- **What happened:** `@mwc/testkit`'s `src/index.ts` re-exports `createTestApp`, so importing the barrel loads
  `@mwc/server` and `@mwc/db`. The Clerk connector's tests (S1.2) need only the provider contract and the svix
  signer, which import neither. The connector's first draft also put 13 entries in `src/` and 14 in `test/`
  (the `big-folder` warning), and a 93-line function in its contract target.
- **Where:** `packages/testkit/package.json` (exports), `connectors/identity-clerk/` (S1.2).
- **What was done:** the two testkit helpers that do not need the server got their own subpath exports,
  `@mwc/testkit/provider-contract` and `@mwc/testkit/webhooks` (also re-exported by the barrel), and the
  connector imports those. The connector's Backend API pieces moved to `src/backend/` (client, calls, errors,
  rate limit, mappers; tests mirrored), and the contract target was split into named steps, so the report is
  back at its S1.0d count.
- **Suggested change:** a line in the placement table's testkit row: a shared test helper that does not need
  the server or a database gets its own `@mwc/testkit/<name>` subpath export.
- **Status:** `open`.

### 2026-11-04: Four source files grew past 300 lines before there was a limit

- **What happened:** No size limit existed until S1.0b, so four source files grew past 300 lines and two test
  files past 500:
  - `packages/identity-core/src/projector.ts`: 528 lines (S1.1);
  - `packages/identity-core/src/fake.ts`: 456 (S1.1);
  - `packages/db/src/diagram.ts`: 418 (S0.2b);
  - `packages/cli/src/main.ts`: 344 at S1.1, 339 after S1.0a;
  - the identity-core tests `projector.test.ts` (791) and `fake.test.ts` (554).
- **Where:** c0592f5 (S1.0b) split them.
- **What was done:** each file was split by responsibility, with behaviour and public import paths unchanged:
  - `projector.ts`: the dispatch (`project`, `replayDeferred`) stayed and is 102 lines now. The handlers moved
    to `projector/` (`users`, `memberships`, `membership-link`, `invitations`) and the shapes to
    `projector/changes.ts`. The user handler gets a `replay` callback instead of importing the entry, so there
    is no cycle.
  - `fake.ts`: the provider class stayed. Its state and dashboard actions moved to `fake/world.ts`, token parsing
    to `fake/tokens.ts` and webhook signing to `fake/webhooks.ts`.
  - `diagram.ts`: the page (`renderSchemaDiagram`) stayed, with `diagram/describe.ts`, `diagram/mermaid.ts`
    and `diagram/markdown.ts` beside it.
  - `main.ts`: the dispatch stayed. The check lanes moved to `check.ts` and the shared io to `io.ts`.
  - The two test files were split by `describe` block into files that mirror the new sources, with their helpers
    in `test/fixtures/`. Every test body stayed the same.
  The `size` rule has enforced 300/500 lines since then.
- **Suggested change:** warn before the limit, not only at it. That became the `near-limit` warning in S1.0d.
  `fake.ts` left its split at 290 lines and is still 290, 97% of the limit; the first report lists it at the top.
- **Status:** `adopted` (the limit in S1.0b, c0592f5; the warning in S1.0d).

### 2026-11-04: Tests were mixed into src/

- **What happened:** From S0.1 to S1.1, tests sat next to the code. There were 30 test files under `src/` in
  six packages (`apps/server` 6, `packages/db` 7, `packages/identity-core` 6, `packages/shared` 5,
  `packages/cli` 4, `packages/testkit` 2). Examples: `apps/server/src/app.test.ts`,
  `packages/cli/src/main.test.ts`. The identity test world lived in `packages/identity-core/src/test-world.ts`,
  and the web's Playwright specs in `apps/web/e2e/`.
- **Where:** 64a9536 (S1.0a), c0592f5 (S1.0b).
- **What was done:**
  - S1.0a moved the tests with `git mv` into each package's `test/`, mirroring `src/`, and `test-world.ts` became
    `test/fixtures/world.ts`.
  - Test support that other packages import stayed in `src/`: `@mwc/db/testing`, `@mwc/identity-core/fake` and
    `/memory-store`, and `@mwc/testkit`.
  - The Playwright smoke was removed (no frontend tests for now).
  - S1.0b added the `tests` rule: no test under `src/`, and nothing in `test/` but tests and `test/fixtures/`.
- **Suggested change:** none left. The `tests` rule and the placement-table rows for test helpers cover it.
- **Status:** `adopted` (S1.0a, 64a9536; S1.0b, c0592f5).

### 2026-11-04: There was no folder map before code was written

- **What happened:** The ten commits from S0.1 to S1.1 (2026-11-03 to 2026-11-04) were written with only a list
  of packages in CLAUDE.md's Layout section. Nothing said what goes inside a package. The result:
  - the server kept its routes in `src/routes/` (`health.ts`, `meta.ts`, `docs.ts`, `web.ts`) beside loose
    platform files (`env.ts`, `logger.ts`, `shutdown.ts`, `version.ts`, `http/`);
  - its startup was in the 49-line `src/main.ts`;
  - the demo server was `src/dev-memory.ts`;
  - the web was flat files (`src/api.ts`, `src/App.tsx`, `src/Home.tsx`, `src/styles.css`);
  - tests sat next to the code (the entry above).
- **Where:** 64a9536 (S1.0a, 102 files changed).
- **What was done:**
  - S1.0a wrote `docs/structure.md` (the map and its rules) and moved the repository into it: `platform/` and
    `modules/health/` in the server, `main.ts` a 3-line entry over `platform/start.ts`, the web in `app/`,
    `pages/`, `api/` and `styles/`.
  - S1.0b enforced the map in `mwc check`.
  - S1.0c (9d1af56) added this skill and its placement table.
- **Suggested change:** none to a rule. A new area, package or connector gets its line on the map before its
  first code (step 1 of "New server module", step 5 of "New workspace package or connector").
- **Status:** `adopted` (S1.0a to S1.0c).

## Report counts

The warning counts of `pnpm mwc structure --report` at each review. The next review can then tell whether the
count clearly grew. The review adds a row.

| Date       | When                                  | near-limit | long-function | big-folder | fan-in | low-coverage | Total |
| ---------- | ------------------------------------- | ---------- | ------------- | ---------- | ------ | ------------ | ----- |
| 2026-11-04 | S1.0d, the first report (no review)   | 2          | 6             | 0          | 4      | 5            | 17    |
