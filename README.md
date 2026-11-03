# Most Wanted Corp v2

Humans and AI agents in one organization: companies with invited members, an org chart that
mixes people and agents, tasks with one kept conversation per task, Claude Code harnesses that
run on laptops, VMs or containers through a small outbound runner, and an inbox for everything
that needs a person. Multi-tenant and container-deployable from the first commit.

This is a clean rebuild of v1 (the Control Plane and the Paperclip fork), stage by stage, with
tests. Why and how: `docs/plan-2026-11-03.md` (the approved plan), `docs/architecture.md`,
`docs/roadmap.md`.

Schema diagram: [docs/schema.md](docs/schema.md) (a Mermaid ER diagram generated from the Drizzle schema).

## Status

Stage **S0 — skeleton and one-command start**: S0.1 (repo setup: workspace, config loader, port map,
`mwc check`, docs) and S0.2 (`@mwc/db`: Drizzle schema v0 with `users`, `companies`, `audit_log`, the
`0000_init` migration, PGlite tests, the migrations drift check) and S0.2b (the generated schema diagram
`docs/schema.md`, drift-checked by `mwc check`) and S0.3 (`@mwc/server`: the Hono API skeleton with
`/healthz`, `/readyz`, `/api/version`, the OpenAPI 3.1 document at `/api/openapi.json` and Swagger UI at
`/api/docs`, request ids and pino logs) and S0.4 (`@mwc/web`: the React/Vite/Tailwind shell with the
shared UI library's design tokens, a Home page showing the API version and readiness through the typed
Hono client, and a Playwright smoke) and S0.5 (the server image, the dev and prod-like compose stacks,
`pnpm dev`, and the `--full` check lane on a real Postgres) are done. Next: `@mwc/testkit` v0 (S0.6).

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
pnpm mwc check          # lint, typecheck, db drift, tests with coverage
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
packages/    shared, cli, db (now); identity-core, identity-clerk, harness, testkit, mcp (later)
deploy/      compose.yml (dev Postgres), compose.prod.yml, Dockerfile.server
docs/        plan, architecture, roadmap, ports, testing, schema (generated)
```
