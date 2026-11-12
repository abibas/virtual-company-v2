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

### 2026-11-12: The org module's names lookup, which the notifications import by its file

- **What happened:** the S5/S6 review's item 4 moved the principals' names (three `namesOf`, three copies of their reads
  in the tasks, inbox and notifications repos) to the org module's `principalNames` (`org/service/names.ts`, 58 lines,
  its reads `org/repo/names.ts`), exported by `org/index.ts`. The org module already calls the notifications service
  (its notices: `org/service/{lifecycle,positions,agents}.ts`), so the notifications reaching `org/index.ts` would close
  a file cycle; `notifications/service/names.ts` imports `org/service/names.ts` by its file instead (no file cycle,
  checked), and org and notifications now import each other as modules, as identity and members already do. The
  notifications repo keeps `members` for an email's address (`service/delivery.ts`).
- **Where:** 3619a1a.
- **What was done:** as above.
- **Suggested change:** a placement row "a read several modules show of another module's rows (names) → the owning
  module's service, exported by its index; a module that the owner itself calls imports that service file directly";
  or a port the notifications define, passed by `app.ts`, if module cycles should stay out altogether.
- **Status:** `open`.

### 2026-11-12: S6c's Lead wake-ups: a background tick that needs the app's live runtime

- **What happened:** the wake-up tick must start chat turns, which only the process holding the runners' sockets and the
  chats' live turns can do, so it could not be a jobs-loop job (`moduleJobs` is composed before `createApp` and has no
  chats runtime). It went to the tasks module as `service/wake/tick.ts` (`leadWakes`, 99 lines), started by `createApp`
  when MWC_JOBS is on or a test passes `AppDeps.leadWakeTimers`; its cross-company reads are `tasks/repo/wakes-due.ts`
  (Biome's raw-access exemption, like `notifications/repo/delivery.ts`). `tasks/service/` went 16 → 17 entries (`wake/`:
  `record.ts`, `message.ts`, `deliver.ts`, `tick.ts`, `settings.ts`, all under 160 lines); the chats module's side is
  `chats/service/team.ts` behind a `TeamChats` port the tasks module calls (passed by `app.ts`). The test helper went to a
  top-level `test/fixtures/wakes.ts`, beside `runs.ts` and `tools.ts`.
- **Where:** the `lead-wake` branch.
- **What was done:** as above.
- **Suggested change:** a placement row "a periodic job that needs the app's live runtime (the runner hub's sockets, live
  turns) → its module's `service/<area>/tick.ts`, started by `createApp` behind MWC_JOBS, its timers injectable"; at the
  S6 review, group the server's top-level test fixtures by module (`fixtures/tasks/{team,runs,tools,wakes}.ts`).
- **Status:** `open`.

### 2026-11-11: S6a's agents' tools: a contract that needs the area's limits, and the tasks service folder

- **What happened:** the tools' inputs (`packages/shared/src/flows/tools.ts`) need the task limits that lived in the
  barrel `flows.ts`, which re-exports `flows/*`: importing it back would have been a cycle (a TDZ error at load). The
  limits moved to `flows/limits.ts`, re-exported by `flows.ts` (public paths unchanged), so `flows/tools.ts` and
  `flows/prompt.ts` import them directly. `apps/server/src/modules/tasks/service/` went 12 → 16 entries (`decision.ts`,
  `lead.ts`, `step-tools.ts`, `tools.ts`, all under 140 lines); the hub's `hub/turns.ts` reached 290 lines, so the tool
  relay went to `hub/tools.ts` (86); the runner's relay went to `turns/turn/tools.ts` and `turn.ts` sits at 284 of 300.
- **Where:** the S6a commits on the `task-tools` branch.
- **What was done:** as above.
- **Suggested change:** a placement line "an area's limits that its contract parts share → `<area>/limits.ts`, never the
  barrel"; at the S6 review, group the tasks module's agent-facing services as `service/tools/` (decision, lead, step).
- **Status:** the hub part `adopted` (2026-11-12, S5/S6 review 1, 1f396f4: `hub/turns.ts` 291 → 167 lines with
  `hub/turn-types.ts` and `hub/turn-resume.ts`, `hub.ts` 289 → 167 with `hub/types.ts`); the contract `adopted`
  (2026-11-12, S5/S6 review 5, a69a788: the one input check `flows/tool-input.ts`, which the server and the runner both
  run, and the words `flows/tool-words.ts`; `flows/tools.ts` 275 → 188); the limits line and the tasks module's
  `service/tools/` still `open`.

### 2026-11-11: S5.3b's step runs: two modules that drive each other, and a test helper for a cross-module world

- **What happened:** the tasks module starts a chat turn (chats) and the chats module tells the tasks module of every
  task conversation's turn (its plan, start, files, end). The placement row "a port B defines, implemented by A" fit:
  the chats module defines `TaskTurnHook` (`chats/service/task-hook.ts`, 78 lines) and exports `taskTurns`
  (`chats/service/tasks.ts`, 109); the tasks module implements the hook (`tasks/service/hook.ts`) and imports only types
  from `chats/index.ts`; `app.ts` makes one chats runtime (`chatsRuntime`, new in `chats/routes.ts`) so both share its
  live turns. Splitting `task-hook.ts` from `tasks.ts` avoided a file cycle with `turns.ts`. The step-run tests needed a
  world across org, machines, chats and tasks: it went to `apps/server/test/fixtures/runs.ts`, a top-level fixture like
  `tasks.ts`, since `fixtures/tasks/` would sit beside `fixtures/tasks.ts`. `packages/db/src/schema/` went 21 → 22
  entries (`task-artifacts.ts`: it imports both `chats.ts` and `tasks.ts`, and `chats.ts` now imports `tasks.ts`, so the
  table could not live in either without a cycle). The runner's collection went to `apps/runner/src/turns/artifacts/`
  (no placement row names a turn's outputs; `turns/` is the closest).
- **Where:** the steps-run commits.
- **What was done:** as above.
- **Suggested change:** a placement row "a module whose service another module drives, and which reports back to it →
  the reporting side's port in its own `service/<x>-hook.ts`, the driven side's facade in `service/<x>.ts`"; group the
  server's top-level test fixtures by module at the S5 review (`fixtures/tasks/{team,runs}.ts`), and the db schema by area.
- **Status:** `open`.

### 2026-11-11: S5.3a's web: one `features/flows/` area with subfolders, and its shared looks and links

- **What happened:** the flows' web went to one area, `apps/web/src/features/flows/` (4 files: `access.ts`, `links.ts`,
  `words.ts`, `Face.tsx`, and 6 folders `list/`, `team/`, `board/`, `drawing/`, `editor/`, `task/`, 2–6 files each, all
  under 200 lines), the pages to `pages/company/flows/` (3 files; `pages/company/` 11 → 12 entries) and the gallery's
  mock to `pages/design/flows/` (3 files). `features/` went 12 → 13 entries and `pages/design/` 12 → 13 (`big-folder`).
  `features/flows/words.ts` (the kinds' colours, the step states' and priorities' words) is imported for its values by 9
  files and `links.ts` by 8 (`fan-in`): they are the area's building blocks, as `components/` is the app's. Six
  components went over 60 lines on the first pass (TaskActions 103, NewTaskSheet 92, StepOptions 88, FlowEditor 80,
  useBoardMoves 77, TeamView 64) and were split into named parts before commit. `api/flows.ts` (124 lines) takes
  `api/` from 24 to 25 entries; `useEvery` is now exported from `api/notifications.ts` for the board's refresh.
- **Where:** the flows-web commit.
- **What was done:** as above.
- **Suggested change:** `fanInExempt` for a feature's own look and link files (`features/<area>/words.ts`,
  `links.ts`), or a placement row for them; at the S5 review, group `pages/design/` mocks by area
  (`pages/design/<area>/`, as `flows/` now) and `api/` by area.
- **Status:** `open`.

### 2026-11-11: S5.3a's flows and tasks: the map's `tasks/` module, and an area's enums beside its contract

- **What happened:** the flows and tasks went to the map's planned `apps/server/src/modules/tasks/` (S5: "tasks,
  messages, kept conversations"), not a new `flows/` area, so no new area was needed; its map line now says what is
  built. `packages/shared/src/enums.ts` would have passed its near-limit with seven enums (231 → 278 lines), so they
  went to `shared/src/flows/enums.ts` beside the area's contract `flows.ts` (limits, task keys, the written form), and
  `enums.ts` re-exports them with one `export *` (239 lines). `org-chart.ts` stays at 239 by exporting
  `peopleAtOrAbove` on a line of its own (Biome merges exports of one source; merged it was 244). The module's
  `rules/machine.ts` reached 252 lines and was split before commit: `rules/moves.ts` (which moves a task has, 53 lines),
  with `TaskNow` moved to the entry `rules.ts`. Folders: `packages/shared/src/` 25 → 27 entries, `packages/db/src/schema/`
  19 → 21 (over its 20), `packages/cli/src/` 15 → 16 (`tasks/`), `apps/server/src/modules/` 11 → 12.
- **Where:** the flows-server commits.
- **What was done:** as above.
- **Suggested change:** a placement row "an area's enums that would push `enums.ts` past its near-limit →
  `<area>/enums.ts` beside the area's contract, re-exported by `enums.ts`"; group `packages/db/src/schema/` by area at
  the S5 review.
- **Status:** `open`.

### 2026-11-10: Pure rules the server and the web both run, and the chart canvas's parts

- **What happened:** the org chart's pure rules (`validateMove`, `validateChart`, `buildTree`, ...) had to run in the web
  too (the drag and drop shows where a card may go before the server judges it). The placement table has no row for
  "pure rules both the server and the web run"; they moved from `apps/server/src/modules/org/rules.ts` (+ `rules/chart.ts`,
  `rules/violations.ts`) to `packages/shared/src/org-chart.ts` (+ `org-chart/`), the `harness.ts` + `harness/` pattern,
  with their tests to `packages/shared/test/org-chart.test.ts` (428 lines). `packages/shared/src/` went from 22 to 24
  entries (`big-folder`). On the web, `apps/web/src/components/org/` reached 12 entries and `features/structure/` 12;
  `OrgChartBoard` (151 lines) and `ChartCanvas` (89) were split into hooks and parts before commit. The card menu could
  not use the shared `Menu`: a fixed panel inside the canvas's transformed layer loses its place, so
  `features/structure/ChartMenu.tsx` portals it to the body.
- **Where:** the org-chart commits (S2.8).
- **What was done:** as above.
- **Suggested change:** a placement row "a pure rule the server and the web both run → `packages/shared/src/<area>.ts`,
  its parts in `<area>/`"; group `packages/shared/src/` by area at the S2 review; a `portal` option on the shared `Menu`
  for triggers inside a transformed layer.
- **Status:** `open`.

### 2026-11-10: Following Codex's session files while a turn runs, in a new `follow/` folder

- **What happened:** multi-agent v2's subagents and every subagent's own steps come from Codex's session files, read
  while the turn runs (6 files: `file.ts` 75 lines, `lines.ts` 50, `parent.ts` 123, `child.ts` 127, `steps.ts` 127,
  `live.ts` 223). They went to a new `connectors/harness-codex/src/follow/`, the 13th entry of
  `connectors/harness-codex/src/` (`big-folder`, was 12), and its tests to `test/follow/`, the 13th of
  `connectors/harness-codex/test/`. The v1 parts (`subagents.ts`, `children.ts`) stayed where they were. The runner's
  repeating timer went to `apps/runner/src/system/time.ts` (`every`) so `apps/runner/src/turns/turn.ts` stays at 235
  lines (231 before; 244 with the timer inline).
- **Where:** the codex-v2-subagents commit.
- **What was done:** as above.
- **Suggested change:** at the S5 review, group the Codex connector's subagent parts (`subagents.ts`, `children.ts`,
  `follow/`) under one `subagents/` folder.
- **Status:** `open`.

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
- **Status:** the daemon part `adopted` (2026-11-12, S5/S6 review 2, 1418c26: `daemon.ts` 298 → 235 lines, its parts
  made in `daemon/runner/parts.ts`, its caps by `capsOf` in `hello.ts`); the runner row still `open`.

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
| 2026-11-12 | S6, before the S5/S6 review           | 34         | 38            | 34         | 12     | –            | 118   |
| 2026-11-12 | S6, after the approved changes        | 30         | 37            | 34         | 12     | –            | 113   |
| 2026-11-12 | S6c merged, before items 3 and 4      | 30         | 38            | 34         | 12     | –            | 114   |
| 2026-11-12 | S6, after items 3 and 4 (fresh check) | 29         | 38            | 34         | 12     | 40           | 153   |
