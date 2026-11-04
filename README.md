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
shell), the server image and compose stacks, `pnpm dev`, `@mwc/testkit`, and `mwc check` with its fast,
default and full lanes (release notes in `docs/roadmap.md`).
**S1 — identity and companies: in progress.** identity-core done (S1.1: the provider-agnostic identity model,
the order-safe projector and reconcile, the fake provider); the repository moved to the approved layout
(S1.0a, `docs/structure.md`: tests in `test/`, the server's platform and modules, a `connectors/` slot, no
frontend tests for now); the Clerk connector (S1.2, `connectors/identity-clerk`, `docs/clerk-setup.md`) with
the provider contract that runs against the fake always and against the real Clerk development instance on
request; the identity tables (S1.3, `0001_identity`) with the tenant layer `tenant(db, companyId)`, raw access
only through `@mwc/db/system` (forbidden in server modules by Biome), and the database identity store, which passes
the same store contract as the in-memory one; sign-in (S1.4: `authn()` for Clerk session tokens and personal API
keys, `requireMembership(role)`, `GET /api/me` with reconcile on sign-in; `MWC_IDENTITY`, `MWC_WEB_ORIGIN`);
companies (S1.5: create with the outbox `create_org` call, list mine, read, rename, soft delete with the name
typed again; `MWC_COMPANY_CREATION`, `MWC_COMPANY_CREATORS`); memberships (S1.6) and invitations (S1.7); Clerk
webhooks (S1.8, `POST /api/webhooks/clerk`); personal API keys and `mwc login` / `whoami` / `logout` (S1.9); the
jobs loop (S1.10: the identity outbox, the webhook event retry and the periodic reconcile, one runner per database by
an advisory lock; `MWC_JOBS`, `MWC_RECONCILE_MINUTES`); the web app for identity (S1.11: sign-in and sign-up with Clerk,
onboarding, the company shell `/c/:slug` with its switcher, Members, API keys, Settings, `/accept-invitation`; the
publishable key comes from `GET /api/config` at run time); next S1.12, the two-person end-to-end scenario.

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
set it uses that database and leaves Docker alone. The API starts with `.env`, then `.env.local`, from the
repository root (Node's `--env-file-if-exists`): `.env.local` wins over `.env`, and variables set in the shell win
over both; `mwc dev` prints which of the files exist, never their contents. `pnpm dev:server` and `pnpm dev:memory`
load them the same way. Elsewhere (the server image, compose) the environment is the only source (`.env.example`
lists the keys).

### Signing in locally

1. Put the Clerk development instance's keys in `.env.local` at the repository root (ignored by git):
   `CLERK_SECRET_KEY=sk_test_...` and `CLERK_PUBLISHABLE_KEY=pk_test_...` (Clerk dashboard → Configure → API keys;
   `docs/clerk-setup.md`). Sign-in turns on by itself once the secret key has the right shape; a placeholder leaves it
   off, and the API log says so by the variable's name. Check without printing anything:

   ```sh
   node --env-file-if-exists=.env --env-file-if-exists=.env.local \
     -e 'console.log(/^sk_(test|live)_[A-Za-z0-9]{20,}$/.test(process.env.CLERK_SECRET_KEY ?? "") ? "yes" : "no")'
   ```

2. `pnpm dev`, then open **http://localhost:9951** (`localhost`, not `127.0.0.1`: the API accepts session tokens
   issued to `MWC_WEB_ORIGIN`, `http://localhost:9951` by default).
3. Sign up or sign in with an email code or Google. The first time, the app asks you to create your company (or to
   ask for an invitation); then it opens `/c/<slug>`: Overview, Members (invite, roles, remove, Sync now), API keys
   (make one for `mwc login`) and Settings (rename, change the address, delete).

Without the keys the app says "Sign-in is not configured on this server" on every page and shows the API status.
The web reads its sign-in settings from `GET /api/config` when it loads, so nothing about Clerk is built into it.

The prod-like stack, the server image as it would run in the cloud (API and UI on 9990, its own
Postgres on 9992, a one-shot `migrate` before the server starts):

```sh
docker compose -f deploy/compose.prod.yml up -d --build --wait
docker compose -f deploy/compose.prod.yml logs server     # pino JSON lines
docker compose -f deploy/compose.prod.yml down            # keeps the data volume
```

Checks (lanes in `docs/testing.md`):

```sh
pnpm mwc check          # lint, banned names, structure, typecheck, db drift, tests with coverage
pnpm mwc check --full   # + the tests on the dev Postgres and the web build
pnpm mwc structure --report  # early warnings: files near their limit, long functions, ... (never fails)
pnpm mwc ports          # the port map (9950–9999)
```

Your own Claude Code (or a script) reaches the API with a personal API key. Make one on the web app's API keys page
(`/c/<slug>/api-keys`; the key is shown once, with the `mwc login` command to paste), then:

```sh
pbpaste | pnpm mwc login --server http://localhost:9950 --company <id|slug>   # or MWC_API_KEY=... ; never an argument
pnpm mwc whoami         # user, company, role and key prefix (MWC_SERVER + MWC_API_KEY take precedence)
pnpm mwc logout         # removes the saved key; revoke it with DELETE .../api-keys/:keyId if it may have leaked
```

The key is saved per server in `~/.config/mwc/credentials.json` (0600, `MWC_CONFIG_DIR` moves it).

Pieces on their own: `pnpm dev:server` (the API against `DATABASE_URL`; `MWC_MIGRATE_ON_START=true`
migrates first), `pnpm dev:web` (Vite on 9951, proxying `/api`, `/healthz` and `/readyz` to 9950),
`pnpm dev:memory` (the API on 9950 on an in-memory PGlite, migrated on start: no Docker, nothing kept).

## Ports

| Port      | Use                                              |
| --------- | ------------------------------------------------ |
| 9950      | API server                                       |
| 9951      | Web dev server                                   |
| 9952      | Postgres (dev compose)                           |
| 9953      | Local runner health                              |
| 9955      | Web preview (`vite preview` of the build)        |
| 9960–9989 | Per-worktree slots (API, web, Postgres triplets) |
| 9990/9992 | Prod-like compose stack: server (API + UI) / PG  |

Full map and rules: `docs/ports.md`.

## Layout

```
apps/        server, web (now); runner (S3)
packages/    shared, db, identity-core, testkit, cli (now); harness-core (S4), mcp (S5)
connectors/  identity-clerk (now); harness-claude-code (S4), jira, github, gateway, harness-codex (S6–S7)
deploy/      compose.yml (dev Postgres), compose.prod.yml, Dockerfile.server
docs/        plan, architecture, roadmap, ports, testing, structure, clerk-setup, schema (generated)
```

Where each kind of code goes, the size limits and the coverage floors: `docs/structure.md`.
