# The brief template

A subagent knows only its brief. Every line it does not need costs reading time; every line it lacks costs a wrong
turn. Fill in each part; leave nothing implied.

```
<One sentence: what to build or fix, and for whom.>  Repo root /Users/abibas/PERSONAL/Most_Wanted_corp_v2.
You work in your own git worktree; check `git rev-parse --show-toplevel` is under .claude/worktrees/, else stop.
Base <commit>. `export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"`.

Read only: <the 2–5 files or docs this task needs>. (Small tasks: CLAUDE.md and the files to change. Medium and
large: also SKILL.md of keep-structure; its lessons log only when you place a new kind of file.)

The problem / the goal: <facts: what happens now, what must happen, Ihor's words when they matter>.

Build: <numbered, concrete: files, routes, fields, codes>. Not in scope: <the tempting extras>.

Contract others rely on: <exact shapes, when a parallel agent or a later step builds on it>.

Tests: <what must be covered; server code keeps full coverage; no frontend tests>.

Rules:
- While iterating run `pnpm mwc check --fast`; run the default lane `pnpm mwc check` once at the end, and
  `pnpm --filter @mwc/web build` when web code changed. Never `--full`.
- Structure warnings never fail. Do not restructure code to avoid a warning; name any new one in the report.
  Add a lessons entry only when the placement table had no answer for you.
- Docs: a one- or two-line done note in docs/roadmap.md; touch other docs only when a contract changed.
- Never touch ports 9950–9952 or 9993. No new dependencies unless the brief says so.
- One commit titled `<title>`, the author from the repo config, no Co-Authored-By, no AI mention. No push, no merge.
- If `pnpm install` rewrites core.hooksPath, set it back to /Users/abibas/PERSONAL/Most_Wanted_corp_v2/.githooks.
- Never read .env* files, .data/master.key or real credentials.

Report in <N> lines: the commit, what changed, anything Ihor must decide.
```

Report caps: tiny and small 5–8 lines, medium 12, large 20.
