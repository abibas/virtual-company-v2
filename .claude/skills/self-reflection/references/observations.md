# Observations

A running log, one row per task the office ran (delegated or done in the main chat), written **when the task ends**,
before merging and before telling Ihor. It is raw material: the reflections read it to find patterns across many
phases (which sizes run long, which briefs go wrong, which efforts are wasted, where rework comes from). Never
rewrite old rows; correct them with a new note.

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

## Log

| Date       | Stage    | Task                                   | Size            | Who / effort | Brief | Min     | Tokens      | Result | After      | Ihor                                   | Note |
| ---------- | -------- | -------------------------------------- | --------------- | ------------ | ----- | ------- | ----------- | ------ | ---------- | -------------------------------------- | ---- |
| 2026-11-04 | design   | Design system, component library       | large           | fable        | A     | 55      | 540k        | dev    | ff         | "NICE!! LET's GO!!"                    | 12 screenshots and a full gallery: good for a first look, too much for later tweaks |
| 2026-11-05 | fix      | Company logos, server                  | medium          | opus/xhigh   | A     | 25      | 373k        | dev    | ff         | —                                      | Exact contract in the brief let the web agent build in parallel; xhigh more than needed |
| 2026-11-05 | design   | Create-company page, logos across app  | medium          | fable        | B     | 43      | 425k        | fix    | ff         | "doesn't look sexy" → liked the result | Missed that Create could skip an open crop: the logo was silently lost |
| 2026-11-05 | fix      | Square crop in the logo picker         | small→small     | fable        | C     | ~20     | —           | stop   | ff         | "wtf why is it take so much time bro"  | Over-scoped brief (reusable cropper, gallery, Settings, five screenshots) for a small ask |
| 2026-11-05 | S1.13    | Structure review note (held)           | tiny            | main         | A     | ~5      | —           | ok     | —          | "For now -> it's fine"                 | — |
| 2026-11-05 | S2.1     | Org tables, backfill                   | medium          | opus/xhigh   | A     | 14      | 241k        | dev    | ff         | —                                      | Brief said skip the reserved tables (no placeholders): avoided waste |
| 2026-11-05 | S2.2     | Org rules                              | medium          | opus/xhigh   | A     | 16      | 200k        | ok     | conflict 1 | —                                      | Pure functions: could have run at high |
| 2026-11-05 | S2.3     | Agents and chart API                   | large           | opus/xhigh   | A     | 26      | 370k        | dev    | ff         | —                                      | Asked for the exact contract in the report: the next three briefs reused it |
| 2026-11-05 | S2.6     | CLI commands, MCP package              | large           | opus/xhigh   | A     | 31      | 374k        | dev    | ff         | —                                      | New package and dependency: xhigh justified |
| 2026-11-05 | S2.4     | Org lifecycle hooks                    | large           | opus/xhigh   | A     | 35      | 412k        | dev    | conflict 1 | —                                      | Cross-module transaction: xhigh justified; a lessons status line lost in the merge |
| 2026-11-05 | S2.5     | Org chart page, agent form             | medium          | opus/xhigh   | B     | ~35, +4 | 474k        | stop   | ff         | "VERY NICE!"                           | Cut by the monthly spend limit; resumed cleanly from saved work |
| 2026-11-05 | fix      | Logo bug, home cleanup, collapsing rail | small          | opus/xhigh   | A     | 16      | 208k        | ok     | ff         | —                                      | Found the real root cause (Create with the crop open); medium would have done |
| 2026-11-05 | fix      | Addresses without /c/                  | medium          | opus/xhigh   | A     | 17      | 218k        | ok     | conflict 2 | —                                      | — |
| 2026-11-05 | fix      | User profiles, name and photo          | medium          | opus/xhigh   | C     | 30, +5  | 435k + 469k | dev    | handback   | —                                      | Brief asserted a missing column that existed; ran in parallel with a cropper change → 8-file conflict |
| 2026-11-05 | fix      | Content width to 1600px                | tiny            | main         | A     | ~3      | —           | ok     | —          | —                                      | — |
| 2026-11-05 | design   | Placements, subscriptions, profiles    | large           | main         | A     | ~25     | —           | ok     | —          | answered four questions, approved      | Asked the four real decisions in one go; Ihor redirected one ("for now SUBSCRIPTION LOGIN") |
| 2026-11-05 | S3.1     | Credential store                       | large           | opus/xhigh   | A     | 35      | 421k        | dev    | ff         | —                                      | Secrets and keys: xhigh justified |
| 2026-11-05 | S3.2     | Sign in with Claude and OpenAI         | large           | opus/xhigh   | A     | 36      | 357k        | dev    | conflict 4 | —                                      | Let it run the real CLI up to the sign-in address: found the real prompts |
| 2026-11-05 | S3.3     | Live limits, token refresh             | large           | opus/xhigh   | A     | 24      | 362k        | dev    | ff         | worked on his real accounts            | Pointing at the old system's working files saved the research |
| 2026-11-05 | S3.4     | Access profiles                        | medium→large    | opus/xhigh   | A     | 44      | 464k        | dev    | conflict 4 | —                                      | Longest of the batch; three parallel agents all edited the same docs |
| 2026-11-05 | S3.5     | Subscriptions page, limits widget      | medium          | opus/xhigh   | B     | 39      | 495k        | dev    | ff         | "SWEET!"                               | Brief missed that Sign in again would add a duplicate (server design gap) |
| 2026-11-05 | fix      | Sign in again renews the subscription  | small           | opus/xhigh   | A     | 11      | 197k        | ok     | ff         | —                                      | Merged while Ihor was signing in: the API restart killed his flow (office's fault) |
| 2026-11-05 | fix      | Sign-in survives a server restart      | small→medium    | opus/xhigh   | A     | 18      | 260k        | ok     | ff         | —                                      | First push failed: the hook ran right after a full check, under load |
| 2026-11-05 | fix      | Scroll to and ring the new card        | tiny            | main         | A     | ~5      | —           | ok     | —          | —                                      | Ihor thought the Codex sign-in failed: the card was below the fold |
| 2026-11-05 | process  | Self-reflection skill, first reflection | medium         | main         | A     | ~15     | —           | ok     | —          | "make some description to keep an eye on quality" → this log | — |
