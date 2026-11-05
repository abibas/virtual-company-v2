---
name: self-reflection
description: How the CEO office (the main chat that plans, delegates, merges and verifies v2 work) reviews its own work and gets faster and better. Use after every batch or stage, whenever Ihor says something takes too long, costs too much or went wrong, after an incident (a lost flow, a failed push, rework, a merge conflict that cost time), and before briefing subagents, to pick the effort and the brief template.
---

# Self-reflection

The goal is Ihor's time: work that lands correct, in as little wall-clock time and as few tokens as the task needs.
This skill is for the main chat. Subagents do not load it; they get its brief template.

## Before every delegation (every time)

1. **Size the task** with [references/effort.md](references/effort.md). It decides the effort, the model, and
   whether to delegate at all. A handful of lines is done in the main chat, not in a subagent.
2. **Write the brief from [references/brief.md](references/brief.md)**: the goal, the exact files, what to read
   (only that), the contract, the checks, the commit, and a report cap. Leave out everything the task does not need.
3. **Plan the merge**: who else touches the same files, which docs it will edit, whether Ihor is in the middle of a
   live flow (then no server merge until he reports back), and whether it needs a migration on the dev database.

## After every task (every time, before merging and before telling Ihor)

Add one row to [references/observations.md](references/observations.md): the size as briefed and in hindsight, who
and at which effort, the office's own grade of its brief (A, B, C), the minutes and tokens from the task
notification, the result (ok, dev, fix, redo, stop), what merging cost, Ihor's reaction, and the one thing worth
learning, and the **Ref**: the subagent id and the commits, so the full transcript can be found later. Keep the row
short; the transcript holds the detail. Be honest about the office's own mistakes; that is what the log is for. A task
done in the main chat gets a row too. A new session starts a new session heading in the log.

## Reflect (after a batch, a stage, a complaint or an incident)

1. **Collect the facts** of the work since the last reflection, from the observations log, not impressions:
   - per delegated task: what it was, its size, its effort and model, wall-clock minutes, tokens and tool uses
     (from the task notifications), and whether it needed a resume, a rebase or a fix afterwards;
   - per merge: conflicts and the time to resolve them, check runs, failed pushes;
   - Ihor's words: complaints, corrections, praise.
   - patterns across phases: which sizes overrun their budget, which brief grades lead to fix or redo, which efforts
     finish far under budget (lower them), where the conflicts come from.
2. **Find the waste**, in this order:
   - rework: a fix needed after a merge, a resume, a redo;
   - over-scoping: anything delivered that nobody asked for (galleries, screenshot sets, refactors, long docs);
   - over-thinking: the effort or model above what the size needed;
   - fixed cost: reading, re-running checks, waiting on sequential steps that could run in parallel;
   - collisions: merge conflicts, a restart that killed one of Ihor's live flows.
   When a pattern needs its why (a brief that went wrong, a run that took twice its budget), open the transcripts
   the rows point to (observations.md, "Sources") rather than guessing.
3. **Choose at most 5 changes**, each with its evidence and its expected saving. Prefer the ones that remove a whole
   class of waste.
4. **Apply the changes that are the office's own** at once: the effort table, the brief template, how the office
   checks, merges and reports, and its memory. **Ask Ihor first** for anything that changes one of his rules (full
   server coverage, no frontend tests, the structure rules, the step-by-step approvals, who commits).
5. **Record it** in [references/reflections.md](references/reflections.md): the date, the facts table, the
   changes, and what to measure next time. Then update the "Evaluated:" line under each session heading in the
   observations log, so the next pass knows where to start. The next reflection checks whether the changes worked and keeps or
   reverts them.

## Standing rules learned so far

- A one-line or one-file change is done in the main chat. A subagent costs about 200k tokens and 10 minutes before it
  writes a line.
- The verified commit is the one merged. Re-run checks only where the merge changed something (a rebase, a resolved
  conflict); the pre-push hook still runs its lane.
- Never merge server code while Ihor is in the middle of something live on the dev stack.
- Parallel agents never edit the same doc. Done notes are one or two lines; the main chat adds them when merging if
  two agents would collide.
- Report what is done in a few lines, in plain words, for Ihor. Long reports are written for nobody.
- Before a push the working tree is clean (`git status --short` empty): the hooks check the files on disk, so a
  formatted file left uncommitted passes them while the commit stays broken. Never pipe a check into `tail` inside an
  `&&` chain; the pipe hides its failure.
