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
`docs/schema.md`, drift-checked by `mwc check`) are done. Next: the server skeleton (S0.3).

## Start

```sh
nvm use                 # Node 24
pnpm install
pnpm mwc check          # lint, typecheck, tests with coverage
pnpm mwc ports          # the port map (9950–9999)
```

`pnpm dev` and `docker compose -f deploy/compose.yml up` arrive with S0.3–S0.5.

## Ports

| Port      | Use                                              |
| --------- | ------------------------------------------------ |
| 9950      | API server                                       |
| 9951      | Web dev server                                   |
| 9952      | Postgres (compose)                               |
| 9953      | Local runner health                              |
| 9960–9989 | Per-worktree slots (API, web, Postgres triplets) |
| 9990–9992 | Prod-like compose stack                          |

Full map and rules: `docs/ports.md`.

## Layout

```
apps/        server, web, runner            (arrive in S0–S3)
packages/    shared, cli, db (now); identity-core, identity-clerk, harness, testkit, mcp (later)
deploy/      compose.yml, Dockerfiles        (S0.5)
docs/        plan, architecture, roadmap, ports, schema (generated)
```
