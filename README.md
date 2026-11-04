# Most Wanted Corp v2

Humans and AI agents in one organization: companies with invited members, an org chart that
mixes people and agents, tasks with one kept conversation per task, Claude Code harnesses that
run on laptops, VMs or containers through a small outbound runner, and an inbox for everything
that needs a person. Multi-tenant and container-deployable from the first commit.

This is a clean rebuild of the previous version (v1), stage by stage, with tests. Why and how:
`docs/plan-2026-11-03.md` (the approved plan), `docs/architecture.md`, `docs/roadmap.md`.

Schema diagram: [docs/schema.md](docs/schema.md) (a Mermaid ER diagram generated from the Drizzle schema).

## Status

**S0 — skeleton and one-command start: done (v0.1.0).** The pnpm workspace, the config loader and port map,
`@mwc/db` (Drizzle schema v0, `0000_init`, the generated schema diagram), `@mwc/server` (Hono with `/healthz`,
`/readyz`, `/api/version`, OpenAPI and Swagger UI, request ids, pino), `@mwc/web` (the React/Vite/Tailwind
shell and its Playwright smoke), the server image and compose stacks, `pnpm dev`, `@mwc/testkit`, and
`mwc check` with its fast, default and full lanes (release notes in `docs/roadmap.md`).
**S1 — identity and companies: in progress.** identity-core done (S1.1: the provider-agnostic identity model,
the order-safe projector and reconcile, the fake provider); next S1.2, the Clerk provider.

## Start

```sh
nvm use                 # Node 24
pnpm install
pnpm dev                # Postgres (Docker, 9952), migrations, API on 9950, web on 9951
```

`pnpm dev` (`mwc dev`) starts the dev Postgres from `deploy/compose.yml` and waits for it, applies the
migrations, then runs the API (`node --watch`, Node's own TypeScript support) and the Vite dev server
side by side with their output prefixed. Open http://localhost:9951. Ctrl-C stops both and leaves
Postgres running; `pnpm mwc dev --down` stops it (the data volume stays). With `DATABASE_URL` already
set it uses that database and leaves Docker alone. Nothing reads a `.env` file automatically: the server
takes its configuration from the environment (`.env.example` lists the keys).

The prod-like stack, the server image as it would run in the cloud (API and UI on 9990, its own
Postgres on 9992, a one-shot `migrate` before the server starts):

```sh
docker compose -f deploy/compose.prod.yml up -d --build --wait
docker compose -f deploy/compose.prod.yml logs server     # pino JSON lines
docker compose -f deploy/compose.prod.yml down            # keeps the data volume
```

Checks (lanes in `docs/testing.md`):

```sh
pnpm mwc check          # lint, banned names, typecheck, db drift, tests with coverage
pnpm mwc check --full   # + the tests on the dev Postgres, the web build and the Playwright smoke
pnpm mwc ports          # the port map (9950–9999)
```

Pieces on their own: `pnpm dev:server` (the API against `DATABASE_URL`; `MWC_MIGRATE_ON_START=true`
migrates first), `pnpm dev:web` (Vite on 9951, proxying `/api`, `/healthz` and `/readyz` to 9950),
`pnpm e2e` (web build and Playwright smoke with the installed Google Chrome).

## Ports

| Port      | Use                                              |
| --------- | ------------------------------------------------ |
| 9950      | API server                                       |
| 9951      | Web dev server                                   |
| 9952      | Postgres (dev compose)                           |
| 9953      | Local runner health                              |
| 9955/9957 | e2e smoke: web preview / in-memory API           |
| 9960–9989 | Per-worktree slots (API, web, Postgres triplets) |
| 9990/9992 | Prod-like compose stack: server (API + UI) / PG  |

Full map and rules: `docs/ports.md`.

## Layout

```
apps/        server, web (now); runner      (S3)
packages/    shared, cli, db, testkit, identity-core (now); identity-clerk, harness, mcp (later)
deploy/      compose.yml (dev Postgres), compose.prod.yml, Dockerfile.server
docs/        plan, architecture, roadmap, ports, testing, schema (generated)
```
