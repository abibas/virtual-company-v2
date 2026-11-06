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
