# Observations

A running log, one row per task the office ran (delegated or done in the main chat), written **when the task ends**,
before merging and before telling Ihor. It is raw material: the reflections read it to find patterns across many
phases (which sizes run long, which briefs go wrong, which efforts are wasted, where rework comes from). Never
rewrite old rows; correct them with a new note.

## Sources: where the full facts are

Rows stay short on purpose. Each row's **Ref** points at the full record, for a later, deeper review (an overnight or
"sleeping mode" pass, or a reflection that needs the why):

- **The session**: `~/.claude/projects/-Users-abibas-PERSONAL-Most-Wanted-Corp/<session-id>.jsonl`, the whole main
  chat: Ihor's messages, the briefs as sent, the office's checks, merges and reports. The log below is grouped by
  session.
- **A subagent**: `~/.claude/projects/-Users-abibas-PERSONAL-Most-Wanted-Corp/<session-id>/subagents/agent-<id>.jsonl`
  (its whole run: what it read, tried, ran and got wrong) and `agent-<id>.meta.json` (its description). The Ref
  gives the id's first 8 characters; `ls …/subagents/agent-<prefix>*` finds it.
- **The result**: the commits in the Ref (`git show <hash>` in this repository), which are permanent.
- Searching: the files are JSON lines; `grep -c '"type":"tool_use"'` counts tool calls, and `jq` reads messages.
- **Retention**: transcripts are kept 365 days (`cleanupPeriodDays`, Ihor's decision on 2026-11-05: "keep for now,
  365 days, so once we feel we are overwhelmed we can remove it"). Nobody deletes them after a review.
- **Evaluated**: each session heading below says how far the reflections have read it. A later pass starts after
  that point, and goes back into evaluated transcripts only to dig for the why of a pattern.

## Columns

- **Date**, **Stage** (S2.4, fix, design…), **Task** (a few words).
- **Size** as briefed (tiny, small, medium, large), and in hindsight when different (`small→medium`).
- **Who / effort**: `main`, or the model and effort (`opus/high`, `fable`).
- **Brief**: the office's own grade of its brief.
  - `A`: precise and complete; nothing missing, nothing extra.
  - `B`: one gap or one extra (a missing fact, an unneeded deliverable).
  - `C`: a wrong fact, an over-scoped ask, or a missing contract that cost real time.
- **Min / Tokens**: wall clock and tokens from the task notification (`~` when estimated).
- **Result**:
  - `ok`: first time right;
  - `dev`: right, with deviations worth knowing;
  - `fix`: needed a follow-up fix;
  - `redo`: had to be done again;
  - `stop`: cut off (a limit, Ihor).
- **After**: what merging cost: `ff` (fast-forward), `rebase` (a clean rebase), `conflict N` (files resolved by hand), `handback` (sent back to the agent).
- **Ihor**: his reaction, in his words when short, else `—`.
- **Note**: the one thing worth learning: why it ran long, what the brief missed, what went well.
- **Ref**: the subagent id prefix (or `main`) and the commits it produced.

## Log

### Session 8f2e137d-f01d-48ef-8530-b3c102ac3ca2 (2026-11-03 to 2026-11-05: v2 plan, S0–S3)

Evaluated: every row below, by the reflection of 2026-11-05 (reflections.md).

| Date       | Stage    | Task                                   | Size            | Who / effort | Brief | Min     | Tokens      | Result | After      | Ihor                                   | Note | Ref |
| ---------- | -------- | -------------------------------------- | --------------- | ------------ | ----- | ------- | ----------- | ------ | ---------- | -------------------------------------- | ---- | ---------------------------- |
| 2026-11-04 | design   | Design system, component library       | large           | fable        | A     | 55      | 540k        | dev    | ff         | "NICE!! LET's GO!!"                    | 12 screenshots and a full gallery: good for a first look, too much for later tweaks | a031d331 · 4438941 b63850c c7751dd |
| 2026-11-05 | fix      | Company logos, server                  | medium          | opus/xhigh   | A     | 25      | 373k        | dev    | ff         | —                                      | Exact contract in the brief let the web agent build in parallel; xhigh more than needed | a2f5b185 · 9f1ec4b |
| 2026-11-05 | design   | Create-company page, logos across app  | medium          | fable        | B     | 43      | 425k        | fix    | ff         | "doesn't look sexy" → liked the result | Missed that Create could skip an open crop: the logo was silently lost | a7b055dc · 746cd06 75d6d74 |
| 2026-11-05 | fix      | Square crop in the logo picker         | small→small     | fable        | C     | ~20     | —           | stop   | ff         | "wtf why is it take so much time bro"  | Over-scoped brief (reusable cropper, gallery, Settings, five screenshots) for a small ask | a7b055dc · b3828d6 |
| 2026-11-05 | S1.13    | Structure review note (held)           | tiny            | main         | A     | ~5      | —           | ok     | —          | "For now -> it's fine"                 | — | main · cc11840 |
| 2026-11-05 | S2.1     | Org tables, backfill                   | medium          | opus/xhigh   | A     | 14      | 241k        | dev    | ff         | —                                      | Brief said skip the reserved tables (no placeholders): avoided waste | a4f26a34 · e808e10 |
| 2026-11-05 | S2.2     | Org rules                              | medium          | opus/xhigh   | A     | 16      | 200k        | ok     | conflict 1 | —                                      | Pure functions: could have run at high | a5fa0f58 · 6598a35 |
| 2026-11-05 | S2.3     | Agents and chart API                   | large           | opus/xhigh   | A     | 26      | 370k        | dev    | ff         | —                                      | Asked for the exact contract in the report: the next three briefs reused it | aec83db4 · 5ea90d9 |
| 2026-11-05 | S2.6     | CLI commands, MCP package              | large           | opus/xhigh   | A     | 31      | 374k        | dev    | ff         | —                                      | New package and dependency: xhigh justified | a3099cbc · 644fb08 |
| 2026-11-05 | S2.4     | Org lifecycle hooks                    | large           | opus/xhigh   | A     | 35      | 412k        | dev    | conflict 1 | —                                      | Cross-module transaction: xhigh justified; a lessons status line lost in the merge | a8a7a1b3 · 8a30621 |
| 2026-11-05 | S2.5     | Org chart page, agent form             | medium          | opus/xhigh   | B     | ~35, +4 | 474k        | stop   | ff         | "VERY NICE!"                           | Cut by the monthly spend limit; resumed cleanly from saved work | ae202340 · 200dec3 |
| 2026-11-05 | fix      | Logo bug, home cleanup, collapsing rail | small          | opus/xhigh   | A     | 16      | 208k        | ok     | ff         | —                                      | Found the real root cause (Create with the crop open); medium would have done | a8d93f96 · 8ecabe7 |
| 2026-11-05 | fix      | Addresses without /c/                  | medium          | opus/xhigh   | A     | 17      | 218k        | ok     | conflict 2 | —                                      | — | ac896a71 · 5325893 |
| 2026-11-05 | fix      | User profiles, name and photo          | medium          | opus/xhigh   | C     | 30, +5  | 435k + 469k | dev    | handback   | —                                      | Brief asserted a missing column that existed; ran in parallel with a cropper change → 8-file conflict | a464b55a · 6466e77 |
| 2026-11-05 | fix      | Content width to 1600px                | tiny            | main         | A     | ~3      | —           | ok     | —          | —                                      | — | main · 2d9e2bc |
| 2026-11-05 | design   | Placements, subscriptions, profiles    | large           | main         | A     | ~25     | —           | ok     | —          | answered four questions, approved      | Asked the four real decisions in one go; Ihor redirected one ("for now SUBSCRIPTION LOGIN") | main · 237ecc6 |
| 2026-11-05 | S3.1     | Credential store                       | large           | opus/xhigh   | A     | 35      | 421k        | dev    | ff         | —                                      | Secrets and keys: xhigh justified | a26b9dd5 · 3e49b4b |
| 2026-11-05 | S3.2     | Sign in with Claude and OpenAI         | large           | opus/xhigh   | A     | 36      | 357k        | dev    | conflict 4 | —                                      | Let it run the real CLI up to the sign-in address: found the real prompts | aacb8a89 · 4b14dc4 |
| 2026-11-05 | S3.3     | Live limits, token refresh             | large           | opus/xhigh   | A     | 24      | 362k        | dev    | ff         | worked on his real accounts            | Pointing at the old system's working files saved the research | aac7c691 · c99df6c |
| 2026-11-05 | S3.4     | Access profiles                        | medium→large    | opus/xhigh   | A     | 44      | 464k        | dev    | conflict 4 | —                                      | Longest of the batch; three parallel agents all edited the same docs | aa80b684 · a62f150 |
| 2026-11-05 | S3.5     | Subscriptions page, limits widget      | medium          | opus/xhigh   | B     | 39      | 495k        | dev    | ff         | "SWEET!"                               | Brief missed that Sign in again would add a duplicate (server design gap) | ac66ee06 · 8f7679f |
| 2026-11-05 | fix      | Sign in again renews the subscription  | small           | opus/xhigh   | A     | 11      | 197k        | ok     | ff         | —                                      | Merged while Ihor was signing in: the API restart killed his flow (office's fault) | aa13190f · d470114 |
| 2026-11-05 | fix      | Sign-in survives a server restart      | small→medium    | opus/xhigh   | A     | 18      | 260k        | ok     | ff         | —                                      | First push failed: the hook ran right after a full check, under load | a1103648 · 7fc442b |
| 2026-11-05 | fix      | Scroll to and ring the new card        | tiny            | main         | A     | ~5      | —           | ok     | —          | —                                      | Ihor thought the Codex sign-in failed: the card was below the fold | main · 02cab27 |
| 2026-11-05 | process  | Self-reflection skill, first reflection | medium         | main         | A     | ~15     | —           | ok     | —          | "make some description to keep an eye on quality" → this log | — | main · 071970a 3f74ff9 |
| 2026-11-05 | fix      | ZIP for a friend, secret scan          | small           | main         | A     | ~8      | —           | ok     | —          | —                                      | git archive (tracked files only) + pattern scan + hash check of key-like fixtures against the DB | main · — |
| 2026-11-05 | fix      | Limits auto-refresh every 3 minutes    | medium          | opus/high    | A     | 12      | 183k        | ok     | ff         | "timings are wrong… pull each 3-4 minutes" | First run at the new effort: 12 min / 183k vs 16–18 min / 200–260k for similar xhigh tasks. Root cause was S3.3's "check once per process" design, which the office accepted without questioning | a2c6e2b2 · e5225d5 |
| 2026-11-05 | fix      | Fable weekly row from limits[]         | small           | main         | A     | ~12     | —           | ok     | —          | —                                      | Read Claude Code's own binary for the real response shape instead of guessing; a piped check hid a format failure until the push hook caught it | main · 5ed1a98 |
| 2026-11-05 | design   | Aligned limit meter rows               | small           | fable/medium | A     | 5       | 79k         | ok     | ff         | "i need to search each time for percents" | Fastest delegation so far: a narrow brief that names the reference look and the exact files, no screenshots asked |
| 2026-11-05 | fix      | Format fix left out of 5ed1a98         | tiny            | main         | —     | ~2      | —           | fix    | —          | —                                      | The office's slip: amended only src/, the formatted test stayed uncommitted; the pre-push hook checks the working tree, so it passed. Found by the next agent | main · after d2886b1 |
| 2026-11-06 | fix      | Full width, strip tooltip below        | tiny            | main         | A     | ~6      | —           | ok     | —          | "design look ugly right now"           | The 1600px cap from 2026-11-05 was a guess at one screen width; on a wider screen it left a gap. Prefer no cap over a magic number | main · (this commit's parent) |
| 2026-11-06 | fix      | Strip tooltip back to the left         | tiny            | main         | A     | ~2      | —           | ok     | —          | "Revert this change… draw it in the same place" | The "hang below" fix was the office's own pick; his complaint was the overlap look, not the position. When a complaint names two things, change only what he asked | main · 44a9530 |
| 2026-11-06 | S3.6     | Structure review: report, 5 suggestions | small          | main         | A     | ~20     | —           | ok     | —          | "let's address all recommended things" | Measured the fan-in options with a throwaway script before suggesting: the 44→~4 claim held (3) | main · — |
| 2026-11-06 | S3.6     | Fan-in counting, folder limits, regroups | medium        | opus/high    | B     | 13      | 148k        | dev    | rebase     | —                                      | Brief said "about 4" and "db test/ to 12 by moving the diagram": both a little off (3; needed schema.test.ts moved too). It fixed them itself and said so | a59526c3 · bc330a5 0f3be90 |
| 2026-11-06 | S3.6     | Web page parts to features/            | small           | opus/medium  | A     | 4       | 65k         | ok     | ff         | —                                      | A pure move with a precise list of folders: fast and clean. Listing the doc lines to fix (not editing them) avoided a collision | adb9798a · fc81548 |
| 2026-11-06 | S3.6     | Placement table, lessons archive       | small           | main         | B     | ~15     | —           | fix    | —          | —                                      | The skill's 150-line cap (a test) was unknown to the office: the push hook caught 173 lines; trimmed the review/lessons sections instead of raising the cap | main · 7c37c07 95ec864 fbeb3d0 |
| 2026-11-06 | design   | Machines: research + plan (plan mode)  | large           | main + 2 explore | A | ~25     | ~240k (explore) | ok | —          | approved; ngrok + Mac awake while held | Two parallel Explore agents (v1 machines, Airia CLI) gave exact facts; two real questions asked, the rest decided | main · 2665846 |
| 2026-11-06 | S4.1     | Runner protocol, machines contracts, fakes | large       | opus/xhigh   | A     | 30      | 292k        | ok     | ff         | —                                      | Asked for the exact contract in the report: it fed three parallel briefs. The office's first doc push hit the banned-names check (v1 file names cited in docs/machines.md) | a143d59f · ce603a5 |
| 2026-11-06 | S4.4a    | Power port + Airia devbox connector    | medium          | opus/high    | A     | 11      | 168k        | ok     | rebase     | —                                      | Exact CLI facts in the brief (commands, metadata keys, defaults, costs) and "never run airia/gcloud": on time, and it found that `up` creates a box when none exists (guarded) | a1754816 · a262663 |
| 2026-11-06 | S4.3     | Runner daemon core (new app)           | large           | opus/xhigh   | A     | 41      | 381k        | dev    | rebase     | —                                      | On budget for a new app at xhigh; it changed the protocol doc for 4003 (exit, per the brief) and added two fake-server methods: say "fakes may grow" in briefs | a2f03200 · 58e5e92 |
| 2026-11-06 | S4.2     | Server: machines, hub, stats           | large           | opus/xhigh   | B     | 53      | 533k        | dev    | rebase     | —                                      | Longest so far; the brief bundled migration + hub + API + stats (could have been two). Brief contradicted itself on who reads (members vs viewers) and missed that a removed machine must keep its row | ab5e871a · 0472ae1 fab3956 |
| 2026-11-06 | S4.4b    | Power: rules, scheduler, API, executor | large           | opus/xhigh   | A     | 47      | 479k        | dev    | rebase     | —                                      | Giving the exact API contract up front let it confirm differences instead of inventing; it kept the box during a waiting chat at the window's end (a sensible extra) | a33f5a79 · e9ace7d |
