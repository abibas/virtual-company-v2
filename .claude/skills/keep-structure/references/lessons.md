# Lessons

This log records where the structure did not fit and what was done about it. Read the `open` entries before
deciding where code goes. The structure review ([review.md](review.md)) brings them to Ihor, marks them
`adopted` or `declined` and moves them to [lessons-archive.md](lessons-archive.md), which nobody needs to read
before working. Keep this file short: an entry is a few lines, and the open ones only. Write down facts only: the commits, files and line counts that show what happened.

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

### 2026-11-10: The model catalogue, and a second data step between two generated parts

- **What happened:** `apps/web/src/features/subscriptions/` went from 19 to 20 entries (`big-folder`: `RunsFields.tsx`,
  a profile's Model and Effort, shared by `ProfileCard.tsx` and `NewProfile.tsx`; split into four parts so no function
  passes 60 lines, and kept off `Providers.tsx`, which would have reached 8 importers). `AgentForm.tsx` came to 237
  lines (`near-limit` starts at 240). Migration `0017_profile_model` needed its data step between the new columns and the
  dropped ones again: generated twice and joined, as `0015` was; the old backfill tests that seed `agents` or
  `access_profiles` through Drizzle before 0017 failed on the changed columns, so `insertAgentBefore0017` and raw SQL
  seed them now. A seeding helper several packages' tests use went to `packages/testkit/src/seed/profiles.ts`.
- **Where:** the profile-model commit.
- **What was done:** as above.
- **Suggested change:** a placement row "a migration's data step between generated parts: generate the additions, append
  the `-- custom:` step, generate the drops and join them into one file"; tests seeding at an older migration write raw
  SQL for the tables a later migration changes. Grouping `features/subscriptions/` stays an open S5 review item.
- **Status:** `open`.

### 2026-11-10: Gateways for Codex grow two folders already over their limit

- **What happened:** `apps/web/src/features/subscriptions/` went from 18 to 19 entries (`big-folder`: `GatewayFields.tsx`,
  the gateway's provider choice, address and headers, split out so `PasteForm.tsx` stays at 220 lines and under the
  60-line function smell) and `connectors/harness-claude-code/src/` from 13 to 14 (`settings.ts`, Claude Code's private
  `--settings` file). The Codex provider overrides went to `connectors/harness-codex/src/gateway.ts` and the TOML
  writers to `config.ts` (9 entries). `Providers.tsx` would have reached 8 importers (`fan-in`); `GatewayCard.tsx` reads
  the profile name through `GatewayFields.tsx` instead.
- **Where:** the codex-gateway commit.
- **What was done:** as above.
- **Suggested change:** none beyond the open S5 review items: group `features/subscriptions/` (profiles, gateways) and
  the Claude Code connector's parser files (`messages.ts`, `subagents.ts`, `system.ts`, `summary.ts`, `context.ts`)
  under `parse/`.

### 2026-11-10: The runner's machine tools in a new `apps/runner/src/tools/`

- **What happened:** finding the machine's CLIs, their versions and installing Claude Code or Codex with npm (4 files)
  have no row in the runner table of SKILL.md; they went to a new `apps/runner/src/tools/`, the 15th entry of
  `apps/runner/src/` (`big-folder`, was 14), `apps/runner/test/` grew to 15 and `apps/server/test/modules/machines/routes/`
  to 14. `apps/runner/src/daemon/runner/daemon.ts` went from 254 to 267 lines (the tools' wiring; the folder browser's
  `unsupported` answer moved into `folders/browse.ts`), the hub's `connection.ts` from 239 to 261 (`runner.caps`,
  `tools.output`).
- **Where:** the machine-tools commit.
- **What was done:** as above.
- **Suggested change:** a runner row "the machine's CLIs: finding them, their versions, installing one → `tools/`"; at
  the S5 review, group the daemon's parts' wiring so `daemon.ts` stays well under its limit.
- **Status:** `open`.

### 2026-11-10: Access profiles of one provider, and a migration whose data step sits between two generated parts

- **What happened:** `0015_profile_provider` needed its data step after the new columns and before the old slot
  columns are dropped, and drizzle-kit asks (interactively) whether a column added beside a dropped one is a rename.
  It was generated in two runs (the additions, then the drops), joined into one file with the `-- custom:` step between
  them and the second run's snapshot kept; the routine says the custom part is "appended". On the web,
  `apps/web/src/features/subscriptions/` grew from 14 to 18 entries (`big-folder`: `NewProfile.tsx`, `Providers.tsx`,
  `profile-options.ts`, `DefaultProfiles.tsx`) and `apps/web/src/features/agents/` from 12 to 13 (`ProfileFields.tsx`,
  split out of `ModelFields.tsx`). The org module's default-profile route went to `modules/org/routes/defaults.ts`
  (routes.ts was at 243 lines) and its profile service to `service/profiles/{give,removal}.ts` (279 lines in one).
- **Where:** the access-profiles-provider commit.
- **What was done:** as above.
- **Suggested change:** the database routine: "a data step that needs old and new columns at once: generate the
  additions, append the `-- custom:` step, then generate the drops into the same file"; group the profile files of
  `features/subscriptions/` under `profiles/` at the S5 review.
- **Status:** `open`.

### 2026-11-10: S5.2 step 4's runner MCP server under `turns/ask/`

- **What happened:** the runner's MCP tool server (`runner.mjs mcp`: JSON-RPC, the socket client) and each turn's
  question socket (6 files) have no row in the runner table of SKILL.md; they went to a new
  `apps/runner/src/turns/ask/` rather than a 15th entry of `apps/runner/src/` (`big-folder`, 14). The chats module's
  question rules went to `modules/chats/rules/questions.ts` beside `rules.ts` (203 lines), as `org/rules/`.
- **Where:** the S5.2 step 4 commit.
- **What was done:** as above.
- **Suggested change:** a runner row "a turn's tools: the MCP server a harness starts and the socket that relays its
  calls to the runner → `turns/ask/`"; S6's tool server (approvals, `report_blocked`…) extends it there.
- **Status:** `open`.

### 2026-11-09: S5.1d's runner `folders/`, and the web's folder browser hook in `api/`

- **What happened:** the folder browser's runner side (path rules, `fs.list`/`fs.mkdir`, Node's calls: 3 files) went to
  a new `apps/runner/src/folders/`, which the runner table of SKILL.md has no row for; `apps/runner/src/` and its
  mirrored `test/` now have 14 entries (`big-folder`, was 13). The browser's state hook calls the API, so it went to
  `apps/web/src/api/folders.ts` (the "hook that calls the API" row), its sheet and field to `features/placements/`.
  `packages/shared/src/runner-protocol/runner-frames.ts` grew to 245 lines with `caps.folders`; the frames themselves
  are their own `runner-protocol/folders.ts`, as `turns.ts` and `update.ts`.
- **Where:** the S5.1d commit.
- **What was done:** as above; `docs/structure.md`'s map lists `folders/`.
- **Suggested change:** a runner row "the machine's folders read and made for the server (the folder browser) →
  `folders/`"; the S5 review's grouping of the runner's `src/` (see the S5.1b entry) should take it in.
- **Status:** `open`.

### 2026-11-09: S5.1b's runner `turns/`, a second raw-access file, and a personal table naming a company

- **What happened:** the runner's chat turns went to a new `apps/runner/src/turns/` (8 files): the runner table of
  SKILL.md has no row for it, and `apps/runner/src/` and its mirrored `test/` now have 13 entries (`big-folder`). The
  chats module fails every company's left-running turns at the server's start, so it got a raw-access file,
  `modules/chats/repo/reaper.ts`, added to biome.json's exemption beside `machines/repo/upkeep.ts`. `credential_uses`
  (personal) now names the company, agent, chat and principal of a chat's use as plain ids, so the db's tenant test
  lists it with the global tables that name a company. `packages/shared/src/enums.ts` reached 8 importers (`fan-in`,
  the new `runner-protocol/turns.ts`); `platform/start.ts` is at 241 of 300 lines (`near-limit`, one line for the
  reaper's call).
- **Where:** the S5.1b commit.
- **What was done:** as above.
- **Suggested change:** a runner row "a harness turn's process, its private folder and its event batches → `turns/`";
  group the runner's `src/` (13) at the S5 review, e.g. `power/`, `hold/` and `stats/` under one machine folder.
- **Status:** `open`.

### 2026-11-09: A test executable another package's tests spawn, and fixtures in a connector's `src/`

- **What happened:** S5.1a needs a fake harness binary for the runner's later tests (a process the runner spawns). The
  placement table has no row for a test executable: it went to `packages/harness-core/scripts/fake-harness.ts` (25
  lines, outside coverage), its logic in `src/scenario.ts` (tested in-process) and its path exported from
  `@mwc/harness-core/fake` as `FAKE_HARNESS_BIN`, though `scripts/` is described as dev tooling. Each CLI's recorded-style
  turns are exported from its connector (`src/fixtures.ts` as `/fixtures`), the "owner's `src/`" row, since testkit
  would pull in the server. `packages/shared/src/harness.ts` imports `protocolObject`, so
  `runner-protocol/common.ts` now shows as `fan-in` (8 importers).
- **Where:** the S5.1a commit.
- **What was done:** as above.
- **Suggested change:** a row "a test executable other packages' tests spawn → the owner's `scripts/`, its logic in
  `src/` and its path exported"; leave `common.ts` out of `fan-in` (`fanInExempt`), as a designed building block.
- **Status:** `open`.

### 2026-11-06: Socket routes, and a hub injected into the test app

- **What happened:** S4.2's runner socket is an ordinary Hono route through `@hono/node-server`'s upgrade (auth as
  middleware, HTTP 401 with no socket); only the transport went to `platform/realtime/sockets.ts`. The placement table
  has no row for it. Tests that inject the hub create the database before the app (`createTestApp({ db, runnerHub })`).
  `platform/http/router.ts` is now imported by 8 modules (`fan-in`).
- **Suggested change:** at the S4 review, a row "a WebSocket route → its module's routes; the transport in
  `platform/realtime/`", and a testkit helper that builds the app with a hub.
- **Status:** the row `adopted` (2026-11-09, "Structure (S4 review 2b)", SKILL.md's server table); the testkit helper
  still `open`.

### 2026-11-06: The db package's `src/` is back to 12 by moving the diagram, not by grouping the access layers

- **What happened:** the S3 review planned `packages/db/src/access/` for `tenant.ts`, `owned.ts` and `audit.ts`
  (the personal-data lesson, archived). Those files are loaded by the running dev API, which restarts on a change, so
  the review moved the dev-only diagram instead (`src/diagram.ts` → `src/diagram/page.ts`, 0f3be90): `src/` has 12.
- **Suggested change:** group the access layers when `src/` next passes 12 (S4's machines or S5's runs may add a
  layer), re-exported as today so no import moves.
- **Status:** `open`.

### 2026-11-04: identity-core's in-memory doubles keep coming back near the limit

- **What happened:** `fake.ts` reached 250 of 300 lines after the S1.2 slug option (split once in S1.4, from 290 to
  230; 239 now); `memory-store.ts` is at 250 (83%, `near-limit`) since S2.4.
- **Suggested change:** none to the rules. When either is next changed, move the fake's test controls (`createUser`,
  `updateUser`, `deleteUser`, `accept`, `addMember`, `failNext`) to `fake/controls.ts` and split the store by entity.
- **Status:** `open`.

## Report counts

The warning counts of `pnpm mwc structure --report` at each review. The next review can then tell whether the
count clearly grew. The review adds a row.

| Date       | When                                  | near-limit | long-function | big-folder | fan-in | low-coverage | Total |
| ---------- | ------------------------------------- | ---------- | ------------- | ---------- | ------ | ------------ | ----- |
| 2026-11-04 | S1.0d, the first report (no review)   | 2          | 6             | 0          | 4      | 5            | 17    |
| 2026-11-05 | S1.13, held; Ihor kept it as is     | 1          | 5             | 1          | 28     | 5            | 40    |
| 2026-11-06 | S3.6, before the review               | 2          | 9             | 8          | 44     | 5            | 68    |
| 2026-11-06 | S3.6, after the approved changes      | 2          | 9             | 0          | 3      | 5            | 19    |
| 2026-11-09 | S4.8, before the review               | 3          | 12            | 11         | 8      | 4            | 38    |
| 2026-11-09 | S4.8, after the approved changes      | 4          | 12            | 2          | 2      | 4            | 24    |
