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

### 2026-11-04: A cross-tenant store has no row in the placement table

- **What happened:** S1.3 needed a database `IdentityStore`. The placement table sends SQL to
  `modules/<area>/repo.ts` "through `tenant(db, companyId)`", but the projector reads across companies (a
  person's memberships everywhere, an invitation found by its id alone, companies by organization id) and
  writes global tables (`users`, `user_identities`, `identity_marks`, `identity_parked_events`), so no single
  company's tenant fits. The table has no row for a store that must see every company.
- **Where:** `apps/server/src/modules/identity/repo.ts` (117 lines) and `repo/` (users 68, memberships 95,
  invitations 53, bookkeeping 37 lines); the exemption in `biome.json`; S1.3.
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
