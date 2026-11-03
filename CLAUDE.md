# Most Wanted Corp v2

A from-scratch rebuild of the Most Wanted corporation product: humans and AI agents in one
organization, tasks, runs of Claude Code harnesses on remote machines, and an inbox for what
needs a human. Approved by Ihor Herasko on 2026-11-03. The plan is `docs/plan-2026-11-03.md`;
the living documents are `docs/architecture.md`, `docs/roadmap.md`, `docs/ports.md`.

## Rules

- **v1 is read-only reference.** `/Users/abibas/PERSONAL/Most Wanted Corp` (Control Plane) and
  `/Users/abibas/PERSONAL/most-wanted-paperclip` (the Paperclip fork) are never edited, run,
  restarted or deployed from here. Their databases, `.data/`, `.env` files, keys and sign-ins are
  never read.
- **Ports 9950–9999 only.** API 9950, web 9951, Postgres 9952, runner health 9953, worktree
  slots 9960–9989 (`pnpm mwc ports --slot N`), prod-like compose 9990–9992. See `docs/ports.md`.
- **No secrets in the repo.** Configuration comes from the environment (`.env.example` lists the
  keys; `.env` is ignored and never read aloud). Credentials are encrypted at rest with a key
  that lives outside the repo.
- **Tenant id everywhere.** Every tenant table has `company_id`, child foreign keys are composite
  `(company_id, parent_id)`, and route code reaches tenant data only through `tenant(db, companyId)`.
- **Tests with every ticket.** A ticket is done when its unit/integration tests are green in
  `pnpm mwc check`. Unit tests for domain code, integration tests for the API on PGlite, runner
  and harness tests against fakes, a few Playwright smoke scenarios per release. No UI unit tests.
- **One step at a time.** Work is delivered step by step; after each step Ihor reviews and
  approves before the next one starts. Commit small, with a message that says what was built and
  how it was verified.
- **Commits are Ihor's.** Every commit is authored and committed as `Ihor Herasko <mostwantedyeah@gmail.com>`
  (set in this repo's git config). No `Co-Authored-By`, "Generated with", or any other trailer or text
  that attributes the work to someone or something else. Commit messages say what was built and how
  it was verified.
- **Everything goes to `main`, in good commits.** For now there are no feature branches or pull requests:
  commit straight to `main`, one coherent change per commit, and push to `origin`
  (`github.com/abibas/virtual-company-v2`, private) at the end of each approved step. Never make the
  repository public or add another remote without Ihor's request.
- **Agents, runs and machines start only on Ihor's request.** Never enroll a machine, start a
  run, send a task message as him, or answer an inbox item for him.

## Toolchain

Node 24 (`.nvmrc`), pnpm (pinned in `package.json`), TypeScript 7, Biome, Vitest.
Relative imports use the `.ts` extension; packages export TypeScript sources directly
(bundling happens only for the deployable images). `index.ts` is for barrel re-exports only;
executable entry points are named `main.ts`/`mwc.ts` (coverage excludes only barrels and the
CLI entry). Biome does not format Markdown.
`docs/schema.md` is generated; after a schema change run `pnpm --filter @mwc/db generate` and
`pnpm --filter @mwc/db diagram`.

```sh
pnpm install            # also installs the git pre-push hook
pnpm mwc check          # biome, typecheck per package, tests with coverage
pnpm mwc check --fast   # the same without coverage (what the pre-push hook runs)
pnpm mwc ports          # the port map
```

## Layout

`apps/server` (Hono API), `apps/web` (React), `apps/runner` (the machine daemon),
`packages/shared` (zod schemas, contracts, ports, config), `packages/db` (Drizzle schema,
migrations, tenant layer), `packages/identity-core` and `packages/identity-clerk`,
`packages/harness` (Claude Code driver), `packages/testkit`, `packages/cli` (`mwc`),
`packages/mcp` (MCP server for humans' Claude Code), `deploy/` (compose and Dockerfiles),
`docs/`. Packages appear as their stage lands (see `docs/roadmap.md`).
