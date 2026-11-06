# Structure review

A short look at the structure as a whole. Its purpose is to turn the report's warnings and the lessons into a
few changes Ihor approves, before the hot spots turn into failures.

## When

- At the end of each stage, before its tag and the stage review with Ihor. It is the last item of every stage
  in `docs/roadmap.md`.
- When the report's warning count clearly grows: compare its total with the last row of "Report counts" in
  [lessons.md](lessons.md). Five or more warnings above that row, or a new kind of warning, is clear growth.
- When Ihor asks for one.

## Steps

1. **Read.** Run `pnpm mwc structure --report`. Its low-coverage group needs a fresh `pnpm mwc check`, because
   `--fast` writes no coverage. Then read the `open` entries of [lessons.md](lessons.md).
2. **Choose at most 5 suggestions.** Each one is a concrete change with its evidence, taken from the report or
   from a lesson:
   - split a file before it reaches its limit: `packages/identity-core/src/fake.ts`, 290 of 300 lines (97%),
     into `fake/<part>.ts` along its public methods;
   - move a file whose place no longer fits: name where it goes and the table row or rule that says so;
   - add a row to the placement table in SKILL.md for a case a lesson found uncovered;
   - loosen or tighten a rule or a threshold, with the warnings or failures it would remove or add.

   Prefer the hot spots that are growing, and suggestions that settle open lessons. Leave out what the next
   stage will rewrite anyway.
3. **Ask Ihor.** List the suggestions, numbered, one or two lines each, with the evidence. He approves, changes
   or declines each one. Nothing changes before he answers.
4. **Land each approved change as its own commit.**
   - A split or a move keeps behaviour, public import paths and the test count the same
     ([splitting.md](splitting.md)), and `pnpm mwc check` is green.
   - A rule or threshold change updates `packages/cli/src/structure/rules.ts`, its tests, `docs/structure.md`
     and SKILL.md in the same commit. The `docs` rule of `mwc check` fails when they disagree.
5. **Record it in [lessons.md](lessons.md).**
   - Mark each lesson the review settled `adopted`, with the commit, or `declined`, with Ihor's reason.
   - Move the settled entries to [lessons-archive.md](lessons-archive.md), newest first, so `lessons.md` holds
     only the open ones (agents read it before every change; the archive is read only for the why of a rule).
   - Add a lesson for a suggestion he declined that should not come back.
   - Add a row to "Report counts" with the report's counts after the approved changes.

## Rules

- Rules change only with Ihor's approval.
- A review never fixes hot spots without his approval. Between reviews, the file you are changing is split as
  part of your change, and the other hot spots wait.
- At most 5 suggestions per review. More than that means splitting the work into stages, not one big refactor.
