# Reflections

Newest first. Each entry: the facts, the waste found, the changes made (and those waiting for Ihor), and what the next
reflection measures to keep or revert them.

## 2026-11-05: the first reflection (design, S2, S3, Ihor's fixes)

Ihor: "why is it taking such a huge amount of time? … for simple coding tasks use medium/high reasoning instead of
xhigh". Earlier the same day: "wtf why is it take so much time bro??? it was a simple request for a change".

### Facts (delegated tasks of 2026-11-04/05, from the task notifications)

| Task                                         | Size, in hindsight | Model / effort | Minutes      | Tokens      | After it                         |
| -------------------------------------------- | ------------------ | -------------- | ------------ | ----------- | -------------------------------- |
| Design system and component library          | Large              | Fable          | 55           | 540k        | —                                |
| Company logos, server                        | Medium             | Opus xhigh     | 25           | 373k        | —                                |
| Create-company page and logos, web           | Medium             | Fable          | 43           | 425k        | crop follow-up, about 20 minutes, stopped on Ihor's complaint |
| S2.1 org tables                              | Medium             | Opus xhigh     | 14           | 241k        | —                                |
| S2.2 org rules                               | Medium             | Opus xhigh     | 16           | 200k        | rebase (roadmap)                 |
| S2.3 org API                                 | Large              | Opus xhigh     | 26           | 370k        | —                                |
| S2.6 CLI and MCP package                     | Large              | Opus xhigh     | 31           | 374k        | —                                |
| S2.4 org lifecycle                           | Large              | Opus xhigh     | 35           | 412k        | rebase (lessons, a status lost)  |
| S2.5 org web                                 | Medium             | Opus xhigh     | stopped, +4  | 474k        | stopped by the monthly spend limit, resumed |
| Home, logo bug, collapsing rail              | Small              | Opus xhigh     | 16           | 208k        | —                                |
| Addresses without /c/                        | Medium             | Opus xhigh     | 17           | 218k        | rebase (2 files)                 |
| User profiles                                | Medium             | Opus xhigh     | 30, +5       | 435k + 469k | 8-file conflict handed back to the agent |
| S3.1 credential store                        | Large              | Opus xhigh     | 35           | 421k        | —                                |
| S3.2 sign-in                                 | Large              | Opus xhigh     | 36           | 357k        | rebase (4 files, a status lost)  |
| S3.3 limits                                  | Large              | Opus xhigh     | 24           | 362k        | —                                |
| S3.4 access profiles                         | Medium             | Opus xhigh     | 44           | 464k        | rebase (4 files, a status lost)  |
| S3.5 subscriptions web                       | Medium             | Opus xhigh     | 39           | 495k        | —                                |
| Sign in again renews the subscription        | Small              | Opus xhigh     | 11           | 197k        | its merge restarted the API and killed Ihor's first sign-in |
| Sign-in survives a restart                   | Small              | Opus xhigh     | 18           | 260k        | first push failed (hook under load) |
| Scroll to the new card (main chat)           | Tiny               | main chat      | about 5      | —           | —                                |

About 7.8M tokens in 20 delegations. Merges: 7 rebases with conflicts (docs every time), 3 lessons entries lost their
status line and were restored by hand, 2 failed first pushes, a `--full` run (about 3 minutes) after most merges on
top of the agent's own checks and the pre-push hook.

### Waste found

1. **Over-thinking.** Every delegation ran at xhigh. Small fixes cost 11–18 minutes and about 200k tokens each: the
   fixed cost of a subagent dwarfs the change.
2. **Fixed reading cost.** Every brief said to read CLAUDE.md, structure.md, architecture.md, the roadmap and the
   keep-structure skill with its lessons log, which reached 778 lines (34 open entries, one added by nearly every
   agent).
3. **Work on non-goals.** Agents restructured code to dodge warnings that never fail (one routes file kept for fan-in,
   files merged or split, helpers moved), wrote long done notes in four docs, galleries and screenshot sets.
4. **Collisions.** Parallel agents all edited roadmap.md, structure.md and lessons.md: every merge of a parallel batch
   needed a hand rebase; one needed the agent back.
5. **Double checking.** The office re-ran the default or full lane on commits the agent had just verified, then the
   pre-push hook ran again.
6. **Incidents.** A server merge during Ihor's first sign-in; the spend limit stopping S2.5.

### Changes made now (the office's own)

1. The effort table ([effort.md](effort.md)): tiny in the main chat, small `medium`, medium `high`, large `xhigh`.
2. The brief template ([brief.md](brief.md)): read only what the task needs, the lessons log only for a new kind of
   file, `--fast` while iterating and the default lane once, no restructuring to dodge warnings, one- or two-line done
   notes, report caps.
3. Merging: a fast-forward of a verified commit is pushed without re-running checks (the hook runs); after a rebase or
   a resolved conflict, the default lane; `--full` only when a migration, the database layer or identity changed.
4. Parallel batches: no two agents edit the same doc; the office writes their done notes at merge time.
5. Already in force: no server merge while Ihor is mid-flow on the dev stack (memory, 2026-11-05).

### Waiting for Ihor

- The S3 structure review: adopting or declining the 34 open lessons is what shrinks the log every agent reads, and its
  first suggestion (count fan-in per module, value imports only) removes most of the warnings agents spend time on.

### Measure next time

Minutes and tokens per size class against the budgets in effort.md; rebases with conflicts per parallel batch; check
runs per merge; Ihor's words about speed.
