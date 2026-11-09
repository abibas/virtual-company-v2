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

### 2026-11-09: Update runner grows four big folders while splitting five near-limit files

- **What happened:** the runner's self-update needed its own `apps/runner/src/update/` (4 files), and the near-limit
  files it had to grow were split along their seams: `runner.ts` (249) into its contract and `runner/daemon.ts`,
  `start.ts` (252) by moving `MainDeps` to `system/deps.ts`, the hub (262) into `hub/sockets.ts` and `hub/replies.ts`,
  the connector's `driver.ts` into `ssh.ts`, `MachineCard.tsx` (241) into `MachineHeader.tsx`. Near-limit warnings went
  from 9 to 4, but `apps/runner/src/` went from 16 to 18 entries, `features/machines/` from 18 to 20, the machines
  `service/` from 15 to 16 and `apps/runner/test/` from 17 to 18 (the report went from 41 to 38).
- **What was done:** nothing yet.
- **Suggested change:** at the S4 review, group the runner's top level (`runner.ts`, `runner/`, `start.ts`, `cli.ts`,
  `power.ts`, `health.ts`) or give `apps/runner/src/` a limit of its own; split `features/machines/` into `card/`,
  `power/` and `add/`.
- **Status:** `open`.

### 2026-11-09: The server's own airia CLI driver pushes `platform/` to 13 entries

- **What happened:** MWC_LOCAL_POWER's driver runs local processes for the server, so it went to
  `apps/server/src/platform/power/local.ts` as the table says (`<area>/`, spawn injected); `platform/` went from 12 to
  13 entries (`big-folder`, the report from 39 to 40). The tunnels' supervisor both the runner and the server run moved
  to `packages/machines-core/src/tunnels.ts` (`@mwc/machines-core/tunnels`, spawn, kill and timers injected).
- **What was done:** nothing yet.
- **Suggested change:** at the S4 review, group the folders that run local processes for the server (`login-helper/`,
  `power/`) under one `platform/processes/`, or give `platform/` a limit of its own.
- **Status:** `open`.

### 2026-11-06: Socket routes, and a hub injected into the test app

- **What happened:** S4.2's runner socket is an ordinary Hono route through `@hono/node-server`'s upgrade (auth as
  middleware, HTTP 401 with no socket); only the transport went to `platform/realtime/sockets.ts`. The placement table
  has no row for it. Tests that inject the hub create the database before the app (`createTestApp({ db, runnerHub })`).
  `platform/http/router.ts` is now imported by 8 modules (`fan-in`).
- **Suggested change:** at the S4 review, a row "a WebSocket route → its module's routes; the transport in
  `platform/realtime/`", and a testkit helper that builds the app with a hub.
- **Status:** `open`.

### 2026-11-06: The runner app has no rows in the placement table

- **What happened:** S4.3 built `apps/runner` with `link/`, `hold/`, `stats/` and `system/` (the real Node deps in
  `system/node.ts`, injected everywhere else); the placement table covers the server, the tests and the web only.
- **Suggested change:** at the S4 review, a short "Runner" block in the table (link, hold drivers, sampler, power
  executor, the real deps in `system/`), kept within SKILL.md's 150 lines.
- **Status:** `open`.

### 2026-11-06: S4.1's contracts push shared's `src/` and `test/` and testkit's `src/` past 12 entries

- **What happened:** the brief fixed the public paths (`@mwc/shared/machines`, `@mwc/shared/runner-protocol` as
  `runner-protocol.ts` + `runner-protocol/`, `@mwc/testkit/runner` as `runner.ts` + `runner/`). `packages/shared/src/`
  went from 12 to 15 entries, `packages/shared/test/` from 11 to 15 (with its first `fixtures/`), `packages/testkit/src/`
  from 12 to 14: three `big-folder` warnings, the report from 19 to 21.
- **What was done:** nothing; S4.2–S4.4 cite these import paths.
- **Suggested change:** give `packages/shared/src/` (one contract file per domain, growing by design) a limit of its own
  in `folderEntriesFor`, or group it by domain behind the same subpath exports when S4.2 or S5 adds the next contract.
- **Status:** `adopted` (S4 structure review, 2026-11-09: shared's `src/` and `test/` warn at 20, mirrored test folders
  as their source, in the commit "Structure (S4 review 4)"; testkit's `src/` keeps 12).

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
