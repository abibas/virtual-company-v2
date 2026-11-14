# Roadmap

Stages of the rebuild, each a sprint that ends in a tagged release and a review with Ihor. Extracted from `plan-2026-11-03.md`; tick items off here as they land.

With each release tag, bump `apps/runner/package.json`'s `version` to the tag (0.5.0 at S4; docs/machines.md, "Runner versions").

## 1. Context

Ihor (2026-11-03) wants to stop growing v1 and re-implement the product from scratch, stage by stage, reviewing each stage and covering it with unit tests, so the result is clean, cloud-deployable as a container stack, and multi-tenant-ready. The new project lives in `/Users/abibas/PERSONAL/Most_Wanted_corp_v2` (created empty today) on ports 9950–9999 (verified free). This supersedes the v2 epic parked in v1's task tracker (it named another folder and ports 4100–4199; the PM updates it when v2 starts).

What v1 is (reference only; never written to):
- **v1, first application** (frozen since 2026-10-08): plain JS, Express 5, node:sqlite, Clerk login without webhooks, AES-256-GCM credential store, hardened Docker agent runtime, permission-prompt relay (`--permission-prompt-tool stdio`), 94 node tests, ~10k lines. A real second-user invitation was never tested.
- **v1, second application** (our changes on top of a large third-party application): about 56k lines of ours on a ~1M-line base (259 tables); the core hooks sit in two 19k–31k-line base files; almost no tests for our logic. Remote execution on the Airia devbox = SSH over IAP + detached `setsid` runs + `sleep` placeholders + a hand-made reverse tunnel for MCP callbacks + a file-queue bridge for API calls. Recorded pain: server restarts kill runs, lease deadlocks, a shared MCP config moved the wrong task, Mac sleep lapsed leases, Stop did not reach the remote process, the box's `settings.json` overrode the run's gateway env.
- Prior spec worth reusing: v1's product roadmap (entities, lifecycle, P0–P5) and its architecture notes.

**First goal for v2:** one configured remote coding agent ("SLOP BOX", a single coder role) that Ihor's main Claude Code chat (CEO office) can message, and whose "needs input" / "blocked" states reach his inbox. Everything else grows from that, in the order below.

## 15. Stage plan (each stage = one sprint ending in a tagged release and a review with Ihor)

### S0 — skeleton and one-command start

Done when: fresh clone → `pnpm i && pnpm dev` serves the web on 9951 against the API on 9950 and compose Postgres on 9952; `docker compose -f deploy/compose.yml up` does the same on 9990–9992; `mwc check` is green; `CLAUDE.md` loads in an agent session in that folder.
1. Workspace scaffold (pnpm, tsconfig base, Biome, `.nvmrc`, `.env.example`, zod `loadConfig()`) — test: config rejects a missing `DATABASE_URL`. **Done 2026-11-03.**
2. `@mwc/db`: drizzle config, `0000_init.sql` (`companies`, `users`, `audit_log`), `migrateToLatest()` — test: migrates on PGlite; a second run is a no-op. **Done 2026-11-03.** S0.2b: the generated schema diagram `docs/schema.md` (Mermaid ER diagram + a section per table), drift-checked by `mwc check`. **Done 2026-11-03.**
3. `@mwc/server`: `createApp(deps)`, `/healthz`, `/readyz` (DB ping + migrations current), `/api/openapi.json`, `/api/docs`, request id + pino — tests: readyz 503 before migrate, 200 after. **Done 2026-11-03.**
4. `@mwc/web`: Vite/React/Tailwind shell with the design tokens from the shared UI library's `theme.css` — Playwright: page loads, shows the API version. **Done 2026-11-03** (the Playwright smoke was removed in S1.0a: no frontend tests for now).
5. Compose (postgres, migrate, server, runner placeholder) + `mwc dev` orchestrator + `docs/ports.md`. **Done 2026-11-03** (`deploy/compose.yml` = dev Postgres, `deploy/compose.prod.yml` = the prod-like stack, `deploy/Dockerfile.server`, `mwc dev`, the `--full` lane on Postgres, `docs/testing.md`).
6. `@mwc/testkit` v0 + `mwc check` + pre-push hook + coverage thresholds. **Done 2026-11-03** (`mwc check`, the pre-push hook and the coverage thresholds landed with S0.1–S0.5; S0.6 adds `@mwc/testkit`, the stale test database sweep of the Postgres lane, `mwc` on plain Node without tsx, and the journal read once for `/readyz`).
7. `CLAUDE.md` (v1 is read-only reference, ports, no secrets, no pushes, tenant id everywhere, tests per ticket), `README.md`, `docs/architecture.md` (this plan's sections 4–13), `docs/roadmap.md`. **Done 2026-11-03** (written with S0.1 and kept current by every step since; no separate commit).

**S0 release notes (v0.1.0, `36ce2a3..v0.1.0`, S0.1–S0.6):**
- pnpm workspace on Node 24 and TypeScript 7 with no build step (Node runs the sources), Biome, Vitest with coverage thresholds (80% lines/statements/functions, 70% branches), the zod config loader and the 9950–9999 port map with worktree slots.
- `@mwc/db`: Drizzle schema v0 (`users`, `companies`, `audit_log`), the `0000_init` migration, `migrateToLatest`, `migrationStatus`, a migrations and schema-diagram drift check, the generated `docs/schema.md`.
- `@mwc/server`: Hono with `/healthz`, `/readyz` (database ping and migrations current), `/api/version`, the OpenAPI 3.1 document and Swagger UI, request ids, pino logs, one error shape, graceful shutdown, the built UI served in production.
- `@mwc/web`: React 19, Vite and Tailwind 4 with the shared UI tokens, the typed Hono client, and a Playwright smoke in the installed Chrome.
- Containers: `deploy/compose.yml` (dev Postgres on 9952), `deploy/compose.prod.yml` (server image, one-shot migrate and its own Postgres on 9990/9992; the plan's "compose up on 9990–9992"), `deploy/Dockerfile.server`.
- `mwc` (plain Node): `check` (fast, default and `--full` lanes: tests again on the dev Postgres, web build, e2e), `dev` (Postgres, migrations, API and web in one command), `ports`; the pre-push hook runs `mwc check --fast`.
- `@mwc/testkit`: `createTestApp`, `createTestDb` (PGlite or Postgres, leftovers swept), `fixedClock`, JSON request helpers, a capture logger.

### S1 — identity and companies

Before S1.2 (2026-11-04, Ihor's approved layout): **S1.0a** the repository in the layout of `docs/structure.md`
(tests in each package's `test/`, the server's `platform/` and `modules/`, `main.ts` a 3-line entry over the tested
`platform/start.ts`, the in-memory demo server in `dev/`, a `connectors/` group, coverage in `.cache/`, raised
coverage floors, no frontend tests for now: the Playwright smoke and its port 9957 are gone). **S1.0b** the
structure step of `mwc check` (layout, package contents, tests only in `test/`, 300/500-line limits, module
files and imports; `packages/cli/src/structure/`), with the oversized files split (the identity projector and
fake provider, the schema diagram, `mwc`'s dispatch, two identity test files). **S1.0c** the project skill
`keep-structure` (`.claude/skills/keep-structure/`): where code goes, the module, package and connector
checklists, the database routine, file size discipline; the structure step's failures point at it. **S1.0d**
the structure keeps improving: `pnpm mwc structure --report` lists early warnings (files near their limit,
long functions, big folders, high fan-in, the weakest coverage) and `mwc check` ends with their summary; the
lessons log (`references/lessons.md`); a structure review at the end of every stage (its last item below);
and the `docs` rule, which fails when `docs/structure.md` or the skill falls behind `rules.ts`.

Frontend tests are off for now (Ihor, 2026-11-04): the stage items below that name a Playwright smoke or an e2e
scenario get one only when he turns them back on; until then those steps are checked by hand at the stage review.

Done when: Ihor signs in, creates a company, invites a second real person who accepts via the emailed link, who appears active as member, is promoted to admin, is removed and loses access immediately; all of it with webhooks off and again with ngrok on; the e2e scenario is green.
1. identity-core: interfaces, normalized events, `FakeIdentityProvider`, projector — unit: duplicate and out-of-order events converge. **Done 2026-11-04** (`@mwc/identity-core`: the `IdentityProvider` and `IdentityStore` ports, `IdentityProviderError`, the zod contracts in `@mwc/shared/identity`, the order-safe projector, `reconcileOrganization`/`reconcileUser`, `FakeIdentityProvider` and `InMemoryIdentityStore`, re-exported by `@mwc/testkit`; rules in `packages/identity-core/README.md`).
2. `connectors/identity-clerk` (`@mwc/identity-clerk`): `verifyAccessToken`, Backend API wrapper, `parseWebhook`, `roleMap` — unit with a fake client; svix signature tests; the opt-in real-Clerk contract test run once against the dev app (also verifies the instance settings in `docs/clerk-setup.md`). **Done 2026-11-04** (`@mwc/identity-clerk` on `@clerk/backend` 3.26.5: `ClerkIdentityProvider` with every port method, Clerk, HTTP and network errors mapped to `IdentityProviderError`, 429 with `Retry-After` honored and Clerk's 250 invitations an hour kept in a sliding window, the role map (owner and admin → `org:admin`, member and viewer → `org:member`; `org:admin` reads back as admin, never owner), `parseWebhook` verifying svix with Clerk's `verifyWebhook` and mapping `user.*`, `organization.*`, `organizationMembership.*`, `organizationInvitation.accepted|revoked` with `updated_at` as the ordering guard; unit tests through a fake Clerk backend, the real `verifyToken` on tokens signed with a local RSA key and the real `verifyWebhook` on deliveries signed with a test svix secret; the provider contract in `@mwc/testkit/provider-contract` (16 cases), run against `FakeIdentityProvider` in every check; `docs/clerk-setup.md`; port 9993 reserved for the visible test browser's debugging port). **Real-Clerk contract run: 2026-11-04, passed** (`pnpm --filter @mwc/identity-clerk contract`: 20 passed, 1 skipped by design, the taken-slug case, as the connector keeps no organization slugs). The first run (8 passed, 11 failed, 1 skipped) stopped at `createOrganization` with 403 `organization_slugs_disabled`: the instance has organization slugs off (Clerk's default), and the connector sent the company's slug. Fixed by never sending one (company slugs are ours): a new capability `organizationSlugs` (false for Clerk; the fake keeps slugs only with `organizationSlugs: true`), the contract's slug case skipped without it, and the S1.5 `create_org` handler sends no slug, so its taken-slug fallback is gone. The cases that then ran for the first time corrected four assumptions: Clerk does not refuse a second invitation to the same email but replaces it (the earlier one turns revoked; the port, the fake and the contract now say so, and the `invite` handler never relied on the refusal); the invitation's `url` carries `ticket` and redirects (303) to `/accept-invitation?__clerk_status=sign_up&__clerk_ticket=...`, while the fixture looked for `__clerk_ticket` on the URL itself; the instance requires a password at sign-up, so the fixture's ticket sign-up completes with a random one; and revoking an accepted invitation is 404 `organization_invitation_not_pending`, now mapped to `conflict` (a 403 for a switched-off feature, such as slugs, maps to `invalid`). **Clerk copies the invitation's private metadata onto the membership** (`mwc_invitation_id` and `mwc_company_id`, in the organization's member list and in the user's own), so the S1.7 link works as built; a unit test pins that shape through the mapper and the projector. Inviting a member is refused as `conflict`; the link lands on `/accept-invitation`; the sign-up's token verifies for `http://localhost:9951` and is refused for another origin. Settings as `docs/clerk-setup.md` says (`slugDisabled` true and the password required at sign-up are recorded there). Cleanup left no `mwc-contract-` users or organizations (checked by the run and by a list call afterwards: the instance holds none).
3. Migration `0001_identity` (users, user_identities, companies columns, principals, memberships, invitations, identity_events, identity_outbox, api_keys) + `tenant()` layer + lint rule — integration: composite-FK rejection; `tenant()` 404 on a deleted company. **Done 2026-11-04** (`0001_identity`: `user_identities` (UNIQUE issuer+subject; `users.primary_email` is no longer unique), `principals`, `memberships` (role, granted role, provider role, status, provider membership, invitation; one per company and user, its own person principal), `invitations` (one pending per email and company, a partial unique index), `api_keys` (SHA-256 hash, runner keys bound to a machine), `identity_events` (the inbox, UNIQUE provider+delivery id), `identity_outbox` (op, idempotency key, retries), `identity_marks` and `identity_parked_events` (the projector's bookkeeping); every tenant table `UNIQUE(company_id, id)` with composite child keys, `audit_log`'s actor included; enums as CHECKs from `@mwc/shared/enums`. `tenant(db, companyId)` in `@mwc/db` (scoped reads, updates and deletes, stamped inserts, transactions; `CompanyNotFoundError` for a missing, deleted or malformed company); raw access only through `@mwc/db/system` (`DbHandle` hides the Drizzle object), which Biome forbids in server modules except the identity repo (`biome.json`, proven by `packages/db/test/system.test.ts`). The database `IdentityStore` (`apps/server/src/modules/identity/repo.ts`) passes the new IdentityStore contract (`@mwc/testkit/store-contract`: the port, convergence of the identity scenario, now `@mwc/identity-core/scenario`, and reconcile) like the in-memory store; `seedCompany` in the testkit.)
4. `authn()` + `requireMembership()` + `GET /api/me` with reconcile-on-sign-in — tests: pending `sts`, wrong issuer, wrong `azp`, expired, API key, revoked key. **Done 2026-11-04** (`apps/server/src/platform/auth/`: `authn()` turns `Authorization: Bearer` into an `Actor` (`kind`, `via` clerk|api_key|run_token, user, principal, company, session) from a session token verified by the identity provider against `MWC_WEB_ORIGIN` (issuer checked again here, `sts=pending` refused with 403 `session_pending` everywhere but `/api/me`, the person found by `(issuer, subject)` in `user_identities`, never by email) or a personal API key (`mwc_pk_` + 32 base62, found by its SHA-256, revoked, expired and unknown keys refused, `last_used_at` written at most once a minute; runner and SCIM keys refused until S3 and later; run tokens a typed slot refused until S4), 401 `unauthenticated` with a Bearer challenge otherwise; `requireMembership(role)` reads our `memberships` through `tenant()`, 404 for a missing or deleted company and a non-member alike, 403 below the role (owner > admin > member > viewer, `@mwc/shared/roles`), and puts `c.var.tenant` and `c.var.membership` on the context; the error handler maps `CompanyNotFoundError` to 404 and a provider that is down to 503 `identity_unavailable`. `GET /api/me` (`modules/identity`, in the OpenAPI document with the `bearer` scheme): the user, their memberships that are not removed in companies that are not deleted, and the session's pending flag; reconcile on sign-in with `reconcileUser` on the database store the first time a person is seen, when their link is missing, or once per new session, retried on a unique violation so concurrent first calls converge. Config: `MWC_IDENTITY` (clerk when `CLERK_SECRET_KEY` is set, else none: identity routes answer 503 `identity_not_configured`, health and the UI stay up), `MWC_WEB_ORIGIN` (web dev 9951 or the slot's web port, the public URL in production), the Clerk keys; the connector is wired in `platform/identity.ts`. The fake provider's tokens gained `sid`, `iss`, `azp`, `exp` and `nbf` parts, checked like Clerk's claims, and `fake.ts` was split (organizations, invitations, tokens). Tests through `app.request()` with the fake: valid, pending, wrong issuer, wrong `azp`, expired, garbage, no header, API keys ok/revoked/expired/unknown/wrong prefix, the role matrix and its 404s, reconcile creating the person and linking the accepted invitation, a second call reading only, concurrent first calls in one server and in two, and `MWC_IDENTITY=none`.)
5. Companies: create (outbox `create_org`), list mine, get, patch, soft delete with name confirmation — test: a retry after a provider failure creates no second org. **Done 2026-11-04** (`apps/server/src/modules/companies/`: `POST /api/companies {name, slug?}` writes in one transaction the company (`provisioning`), the creator's person principal and active owner membership, the outbox `create_org` row (idempotency key `create_org:<companyId>`, the creator's subject in its payload) and per-field audit rows; a slug left out is derived from the name (accents dropped, lower-case kebab, at most 63 characters, `company` when nothing is left) and tried with `-2` … `-10` and three random suffixes when taken, a chosen slug that is taken is a 409; only a person signed in with a session and linked here may create (an API key 403 `forbidden`, a person not linked yet 403 `user_not_linked`), under `MWC_COMPANY_CREATION=any|allowlist|none` (`any` by default, `allowlist` in production) with `MWC_COMPANY_CREATORS` (emails); `GET /api/companies` lists my companies with my role, exactly the companies `GET /api/me` lists (through the identity service, `companiesOf`); `GET /api/companies/:companyId` member and above; `PATCH` admin and above, one audit row per changed field with the actor's principal and the request id, 409 `slug_taken`; `DELETE {confirmName}` owner only, 422 `confirmation_mismatch`, a soft delete (`status = deleted`, `deleted_at`) with the outbox `delete_org` row (the organization id when there is one) and audit rows, after which `tenant()` makes the company a 404 for everyone. The outbox handlers (`service/organizations.ts`, for the S1.10 loop): `create_org` looks the organization up by `mwc_company_id` first and creates it only when there is none (without the slug when the provider's is taken), then links the company and turns it active (audit rows by the system; since the S1.2 fix of 2026-11-04 it sends no slug at all); `delete_org` deletes the recorded organization or the one found by metadata, an organization already gone counting as success. `platform/jobs/outbox.ts`: `enqueueOutbox` in the caller's transaction and `processOutboxRow`, which marks a row done or leaves it pending with `attempts`, `last_error` and `next_attempt_at` (30 s doubling to 1 h, or a longer Retry-After), `failed` after 12 tries. `@mwc/db`: `withNewCompany(db, input, work)` (the company row and its first tenant rows in one transaction, the first free slug by `on conflict do nothing`), `TenantDb.updateCompany` and `lockCompany`, `auditChanges`, `isUniqueViolation`; `companyMember(deps, role)` types a zod-openapi route's middleware. Tests through `app.request()` with the fake: every route's happy path, 401, 403 for the wrong role, 404 across companies and 400/422, the policy modes, slug derivation and collisions, audit rows field by field, the soft delete hiding the company, and the handlers: the happy path, a failure after the provider created the organization then a retry with still one organization, a failure before it acted, an organization found by metadata, a company deleted before or while the handler ran, and `delete_org` by id, by metadata, with none, already gone and failing once.)
6. Memberships: list, patch role (last-owner guard), remove (reports move up, keys revoked) — per-field audit rows asserted. **Done 2026-11-04** (`apps/server/src/modules/members/`: `GET /api/companies/:companyId/members` (viewer and above) lists the memberships that are not removed, in the order people joined, with each person's name, email and picture (global `users` rows read through the identity service, `profilesOf`, no new raw-access exemption), role, status and joined time; a plain list, no paging yet. `PATCH .../members/:membershipId {role}` (admin and above): an owner may give any role, an admin may move people among admin, member and viewer but not change an owner's role or make an owner (403 `forbidden`); the role the member has already is a 200 that writes nothing; otherwise `role` and `granted_role` both take the new role, with one audit row per changed field (actor principal, request id) and the outbox `update_role` row. `DELETE .../members/:membershipId` (viewer and above): anyone may leave, an owner may remove anyone, an admin anyone but an owner; the membership turns `removed` (the person's sessions get 404 on the company at once), their API keys in the company get `revoked_at` (401 at once), each with its audit row, and the outbox `remove_member` row follows. Both run in one transaction under the company row's lock (`lockCompany`), re-reading the acting member's and the target's memberships there, so the last-owner guard (409 `last_owner`: no change or removal may leave the company without an active owner) holds under concurrency; an unknown, malformed, removed or other company's membership is a 404 `member_not_found`. The outbox keys are new per change (`update_role:<membershipId>:<id>`), and the handlers (`service/provider.ts`, for the S1.10 loop) push the membership as it is when they run: `update_role` sets the provider role from the membership's role through the provider's role map, `remove_member` removes the person while the membership is still removed (one active again is left alone); a member or organization already gone counts as done, a company with no organization yet rejects so the row is tried again, a deleted company or a person with no identity at the provider needs nothing. "Reports move up" waits for `org_positions` (S2.4): `service/remove.ts` marks the place in the removal's transaction. Shared pieces moved to the platform: `companyRoute(deps, {role, path, tag})` (`platform/auth/membership.ts`, the company route base S1.5 had in the companies module) and `outboxProvider` / `outboxTenant` (`platform/jobs/outbox.ts`). Tests through `app.request()` with the fake: the list, 401, 403, 404 across companies and for unknown memberships, 400; the full role matrix for both changes; no-op; a role the provider raised; the last-owner guard on demote, remove and leave, with suspended owners not counted; two owners demoting themselves or each other, and leaving, at the same time leave exactly one owner; self-leave for every role; access lost at once by session and API key; keys revoked; audit rows field by field; the outbox rows; and the handlers: the happy paths, rows run out of order, a provider failure then a retry, a lost answer, a member already gone, an organization not created yet, a removed or re-activated membership, a deleted company, no provider.)
7. Invitations: create/resend/revoke; outbox worker; projection via webhook, sign-in reconcile, periodic reconcile, manual sync — tests cover all three paths, expiry, revoked-then-accepted. **Done 2026-11-04** (`apps/server/src/modules/members/` for the invitations, `modules/identity/` for the acceptance paths, as the map places them: `POST /api/companies/:companyId/invitations {email, role}` (admin and above; an admin may not invite an owner, the members' role rules) normalizes the email (trimmed, lower-cased), refuses a member's email (anyone the member list shows) with 409 `already_member` and an email with a pending invitation with 409 `invitation_pending`, and writes in one transaction under the company's lock the invitation (`pending`, `expires_at` now + 14 days, the inviter's principal), its audit rows and the outbox `invite` row (`invite:<invitationId>`, with the redirect URL `<MWC_WEB_ORIGIN>/accept-invitation`); overdue pending invitations of the company are stored as `expired` first (a system change, audited), so their email is free again. `GET .../invitations` (admin and above) lists the pending ones newest first, or `?status=accepted|revoked|expired|failed|all`; the status shown is the status as of now (a pending invitation past its expiry shows as expired, `invitationStatusAt` in `@mwc/shared/identity`), with `sent` once the provider has it. `POST .../invitations/:id/resend` (a pending one only, else 409 `invitation_not_pending`) moves `expires_at` to now + 14 days, forgets the provider invitation it followed and queues an `invite` row with a new key whose `replaces` names it. `DELETE .../invitations/:id` revokes locally first (`revoked`, audited), then the outbox `revoke_invite` row; revoking a revoked invitation writes nothing; an admin may not resend or revoke an owner's invitation. The outbox handlers (`service/invitation-provider.ts`, for the S1.10 loop): `invite` looks for the provider's copies of the invitation by `mwc_invitation_id` first, so a retry after a lost answer adopts the copy instead of sending a second email; it sends with our metadata (`mwc_invitation_id`, `mwc_company_id`), the role, the days left and the redirect URL, stores `external_invitation_id`, revokes the copy a resend replaces, sends nothing for an invitation no longer pending, past its expiry or already accepted at the provider, waits (rejects) while the company has no organization, and fails the row at once (`OutboxGiveUpError`, new in `platform/jobs/outbox.ts`) with the provider's refusal as `last_error` and the invitation `failed` when the provider answers `invalid` (the Clerk member cap is left to Clerk: no local count), as does the row's last allowed try of any other failure; `revoke_invite` revokes the provider invitation and every pending copy found by metadata, an accepted, expired or vanished copy counting as done. Acceptance, three paths into the one projector: (a) `projectIdentityEvent(deps, event)` (`modules/identity/service/sync.ts`, exported for S1.8's webhook inbox) projects one normalized event in a transaction; (b) `GET /api/me`'s reconcile on sign-in, unchanged but now on the app's clock; (c) `reconcileCompany(deps, companyId)` (for S1.10's periodic reconcile) and `POST /api/companies/:companyId/sync` (admin and above, "Sync now") run identity-core's `reconcileOrganization` for the company and say what they did. The database store reads a pending invitation past its expiry as `expired`, so an acceptance after the expiry activates nobody on any path; after (a) and (c), a provider membership that came from an invitation revoked, expired or failed here (linked by metadata or the provider's invitation id, never by email), of someone who is not an active member, is queued for removal at the provider (`remove_member` with the subject, one row per provider membership; the members module's handler leaves the person alone if they are active here by then). The revocation of a copy a resend replaced is ignored by both paths, so a resend never revokes our invitation. Roles come from our invitation row; `org:admin` still maps to admin, never owner. Tests through `app.request()` and the handlers with the fake provider: every route's happy path, 401, 403 for the wrong role, 404 across companies and for unknown invitations, 400; the role matrix of who may invite whom; `already_member`, `invitation_pending` and two concurrent invitations of one email; the list filters and the expiry as of now; resend and revoke, their audit and outbox rows; the handlers' happy paths, a lost answer then a retry with one copy, a provider failure, an organization not created yet, an invitation revoked, expired or accepted first, the give-up and the last try, two resends queued together, a revoke finding a copy by metadata; the three acceptance paths, each ending with the person active in `GET .../members` with the invitation's role; an acceptance after the expiry, a revoke that crossed the acceptance, events out of order and repeated, an invitation accepted by another email, a removed member invited again with a new role, the replaced copy's revocation.)
8. `POST /api/webhooks/clerk`: raw body, verify, dedupe, process, retry — tests: replay, bad signature 400. **Done 2026-11-04** (`apps/server/src/modules/identity/`, the module the map gives webhooks: the route in its `routes.ts`, no `authn()` (the svix signature over the exact body is the authentication), the body read raw and capped at 512 KB (413 `payload_too_large`); 503 `webhooks_not_configured` without `CLERK_WEBHOOK_SIGNING_SECRET` (new, optional, in `@mwc/shared/config` and passed to the connector, whose `webhooks` capability is now on only with it) or without a provider, the server staying healthy; a bad or missing signature, another secret, a timestamp more than 5 minutes off or a tampered body is a 400 `invalid_signature`, a signed body that is not JSON or not a valid event a 400 `invalid_payload`, and neither records anything. `service/webhooks.ts` verifies through the provider's `parseWebhook`, inserts the delivery into `identity_events` `on conflict (provider, external_event_id) do nothing` (the svix id), so a replay is a 200 `duplicate` that is not processed again, and processes it inline: `projectIdentityEvent` now writes the audit rows of what it changed in memberships and invitations (activate, update, remove, accept, revoke; one row per field, sorted; actor `system`, the svix id as the request id, no principal) through `auditChanges` in the projection's own transaction (`repo/audit.ts`, with `tenantOf` of `@mwc/db/system`, a tenant on an open raw transaction; a company deleted here gets no new rows), and the row turns `processed`. A processing failure is still a 200 (`failed`): the row is `failed` with `attempts`, `last_error` and `next_attempt_at` after the jobs' backoff. `service/events.ts`: `retryIdentityEvents(deps, { limit })` for S1.10's loop claims due rows (`pending` past the 5-minute lease every recorded row starts with, so an inline try that never finished is picked up; `failed` past their backoff) under `for update skip locked` on both drivers, oldest event first, and processes each once; the 12th failed try gives the row up (`failed`, `next_attempt_at` null), as the outbox does. The backoff and `describeFailure` moved from the outbox to `platform/jobs/retry.ts`, shared by both (the outbox keeps its names). An event type this product does not project is recorded once as `ignored` (already processed) and answered 200 `ignored`: `parseWebhook` now resolves such a delivery as an `IgnoredIdentityEvent` (the delivery id and the provider's own type, `@mwc/shared/identity`) instead of null, in the port, the fake and the Clerk connector, and migration `0002_identity_inbox_ignored` lets `identity_events.type` hold `ignored`. Tests through `app.request()`: with the real Clerk connector's `parseWebhook` on deliveries signed by `@mwc/testkit/webhooks`, a good event processed, a replay, every refusal writing no row, oversized bodies with and without a length header, an unused type, 503 in both cases, a provider failure, the OpenAPI entry; with the fake's deliveries, an invitation accepted then the member active in `GET .../members`, out-of-order, replayed and redelivered events converging, a deleted person, membership and company never revived by late or newer upserts, the audit rows field by field; a processing failure (a `check (false) not valid` constraint added for the test) retried after its backoff, the give-up after 12 tries, the audit rows rolled back with the projection and landing with it on the retry, a stranded pending row, the batch limit, two retry passes at once. The real ngrok hookup with Ihor is still to do: `docs/clerk-setup.md`, "Webhooks".)
9. Personal API keys: create/list/revoke; `mwc login`, `mwc whoami`. **Done 2026-11-04** (`apps/server/src/modules/api-keys/`, the module the map names: `POST /api/companies/:companyId/api-keys {name, expiresInDays?}` (any active member, for themselves, signed in with a session only: an API key caller gets 403 `forbidden`, so keys never mint keys) makes `mwc_pk_` and 32 base62 characters from the CSPRNG without modulo bias (`generateApiKey` and `randomBase62` in `platform/auth/api-keys.ts`), stores the SHA-256 and the display prefix (`mwc_pk_` and 4 characters), expires after 90 days by default (1 to 365, else 400 `invalid_request`), stores `scopes` empty, which means full access as that member in that company, and answers 201 with the whole key (`secret`) once, with `cache-control: no-store`; the key is never stored, logged or audited. It runs in one transaction under the company's lock with the caller's membership read again (403 when it is no longer active), so a concurrent removal either revokes the new key or refuses it. Audit rows: `create` with kind, name, prefix, principal, scopes and expiry, `revoke` with `revokedAt`, each with the actor's principal and the request id. `GET .../api-keys` lists my personal keys newest first with their status as of now (active, expired, revoked), creation, expiry and last use; `?all=1` (or `true`) lists every personal key in the company with its owner (principal, user, name, email; profiles through the identity service) for admins and owners, 403 below; never a hash or a secret. `DELETE .../api-keys/:keyId` revokes (`revoked_at`): anyone their own key (a key may revoke itself), admins and owners anyone's, 403 otherwise; a key revoked already is a 200 that writes nothing; another company's key, a runner key, an unknown or malformed id are 404 `api_key_not_found`. The key format moved to `@mwc/shared/api-keys` (`API_KEY_PATTERN`, `apiKeyKind`, `apiKeyPrefix`, `PERSONAL_KEY_DAYS`), shared by the server and the CLI. `packages/cli`: `mwc login --server URL --company ID|SLUG` reads the key from `MWC_API_KEY` or standard input (piped, or a prompt with echo off on a terminal), refuses it as an argument (exit 2, never echoing it), checks its shape, calls `GET /api/me` and that the key's company is the one named (by id or slug) and active there, warns before sending it over plain http to another host, and saves `{server, companyId, companySlug, key}` per server, with the last login current, in `~/.config/mwc/credentials.json` (0600, folder 0700, a temporary file renamed over the old one; `MWC_CONFIG_DIR`, else `$XDG_CONFIG_HOME/mwc`); `mwc whoami [--server URL]` prints the server, user, company, role and key prefix from `GET /api/me`, with `MWC_SERVER` and `MWC_API_KEY` taking precedence over the file, and exits 1 when not logged in or on a 401; `mwc logout [--server URL]` removes a server's login (not logged in is not an error; the key stays valid until it expires or is revoked). The file helpers (`readCredentials`, `saveLogin`, `removeLogin`, `resolveLogin`, `normalizeServer`) are exported as `@mwc/cli/credentials` for S2.6's `@mwc/mcp`. Tests: through `app.request()` with the fake provider, create (secret once, SHA-256 and prefix stored, audit rows), the key on `/api/me` and on a company route, its own company only, every role, the expiry bounds, a key caller refused, 401 and 404; my list against `?all=1` for admins and owners, a key without a membership, 403 below admin; revoke my own, a key revoking itself, another's as admin or owner, 403 for members and viewers, the revoked key's 401, the no-op, 404 across companies; the secret and its hash absent from every list, revocation, `/api/me`, the OpenAPI document, the audit rows and the logs; the pure rules; the generator's alphabet and its rejection of biased bytes. The CLI in-process with an injected fetch and a temporary config folder: login by environment, pipe and hidden prompt, by slug and id, a wrong company, a gone or suspended membership, a 401, a server down or not this API, no key or the wrong kind, the key as an argument, usage errors, a file it cannot write; the file's modes, its atomic replacement and a failed rename leaving the old file; whoami from the file, with the environment taking precedence, `--server`, not logged in, a 401; logout.)
10. Jobs loop (outbox, reconcile, event retry; single runner via advisory lock; `MWC_JOBS=on`). **Done 2026-11-04** (`apps/server/src/platform/jobs/`: `runner.ts` runs a tick every 5 s from `platform/start.ts` when `MWC_JOBS` is on (new in `@mwc/shared/config`: on by default, off with `NODE_ENV=test`; `MWC_JOBS: "on"` in the prod-like compose stack), one injectable timer at a time so ticks never overlap; `lock.ts` makes it one runner per database with `pg_try_advisory_lock` on a session of its own (`reserveSession`, new in `@mwc/db/system`: a connection reserved from the pool, PGlite's only session), checked before every tick, tried again every 30 s by the others, and freed with its session when the holder dies; PGlite has advisory locks and runs the same code, but its one session cannot exclude a second holder in the same process (documented, and a test says so). `run.ts`'s `runJobsOnce(deps)` runs the outbox (`outbox-drain.ts`: up to 20 due rows claimed with a 5-minute lease under `for update skip locked`, in enqueue order, each through `processOutboxRow` with its op's handler from `outboxRegistry`, which refuses an op two maps handle; an op with no handler fails the row at once with that said in `last_error`), then `retryIdentityEvents`, then the periodic reconcile (`reconcile.ts`: every active company with an organization about once per `MWC_RECONCILE_MINUTES`, new, default 10, each in its own slot from the last 32 bits of its id, at most 10 a tick, longest waiting first; recorded in the new nullable `companies.reconciled_at`, migration `0003_company_reconciled_at`, a failure included, so a failing company comes round again in its next slot; a company deleted meanwhile is skipped), each job's failure caught and logged with pino; without a provider the ticks idle after one log line and the outbox waits. `app.ts`'s `moduleJobs(deps)` composes the modules' handler maps, the event retry and the reconcile, so no module imports the loop. `start.ts` makes one identity provider for the routes and the jobs; `shutdown.ts` stops the loop with the HTTP server (waiting up to 5 s for the tick in flight, then giving the lock up) before closing the database. `/readyz` has a `jobs` block (enabled, holds the lock, last tick, outbox rows due and failed; the counts null when unreadable), which never makes it fail. Tests: `runJobsOnce` on the fake provider taking a company from creation to an invitation accepted at the provider with nothing but ticks (create_org failing once, the invitation deferred until the organization exists, then sent, the member active after the next reconcile), every op through the one registry, a webhook event retried, the order of the jobs, a failing job isolated, idle without a provider; the drain's claim, lease, batch, concurrent passes, backoff, give-up and unknown op; the reconcile's slots (the SQL against the TypeScript), due and not due, the spread over an interval, skipped companies, `updated_at` kept, failures and companies deleted meanwhile; the lock taken, held once, lost and taken again, given up, and on Postgres two pools excluding each other with the holder's death freeing it; the loop with timers fired by hand (ticks, no overlap, waiting for and losing the lock, a lock it cannot try, a tick failing outside its jobs, one idle line, stop waiting for the tick, its timeout, a release that fails); two runners on one Postgres where only the lock holder runs; `start` with `MWC_JOBS=on`, the shutdown order, the configuration defaults and the readyz fields. Waking the loop early with `NOTIFY` on enqueue is left for later.)
11. Web: sign-in, onboarding, `/:slug` switcher, Members page, `/accept-invitation`. **Done 2026-11-04** (`apps/web`: `@clerk/react` 6.18.4 (Clerk's current React SDK; 6.18.5 is younger than pnpm's release-age gate), telemetry off, its publishable key read at boot from the new `GET /api/config` (no auth, in the OpenAPI docs: `identity` `clerk` or `none`, `clerkPublishableKey` with `clerk` only, `webOrigin`, `apiUrl`; picked field by field from the configuration, never a secret, `cache-control: no-store`; in the health module beside `/api/version`), so one built image runs anywhere; with `identity: none` every page says "Sign-in is not configured on this server" with the API status. A hand-rolled router (`app/router.tsx`, the History API, `useLocation`, `<Link>`, `matchPath`; no dependency), which Clerk navigates through (`routerPush`/`routerReplace`). Pages: `/sign-in` and `/sign-up` (Clerk's `<SignIn/>`/`<SignUp/>`, path routing), `/accept-invitation` (Clerk's sign-up, or sign-in for `__clerk_status=sign_in`, with hash routing so the ticket stays in the query; `complete` goes to sign-in; signed in, it opens the company of the newest Clerk membership once `GET /api/me` lists it, and otherwise says the invitation is accepted and checks again every 10 s), `/` (the last company opened in this browser, else the first, else onboarding), `/companies/new` ("Create your company": name, optional slug, "or ask for an invitation"), and the company shell `/:slug` (a header with the company switcher, Clerk's `<UserButton/>`, Overview, Members, API keys, Settings; Clerk `setActive` with the company's organization on every switch, failures ignored; a "being set up" notice and a 5 s poll while the company is provisioning; an unknown slug is checked once more before "No company here"). Members: the table (name, email, role, status, joined), a role dropdown with exactly the roles the caller may give, lowering one's own role confirmed first, remove and "Leave company" confirmed inline, pending invitations with resend and revoke, the invite form (an admin is never offered owner), Sync now; viewers and members read only. API keys: create (name, days), the secret shown once with a copy button and "you won't see this again" (component state only, never storage), my keys or everyone's (admins) with revoke, and the `mwc login` command with the API URL and company id. Settings: rename and slug change (admins), delete by typing the exact name (owners). Every call sends `Authorization: Bearer <getToken()>`; server refusals show as plain sentences (`last_owner`, `already_member`, `invitation_pending`, `slug_taken`, `confirmation_mismatch`, ...); `session_pending` and `user_deactivated` stop at a plain page with Sign out; no `window.alert`/`confirm`/`prompt`. Server and shared changes, with tests: `GET /api/me` memberships carry `identityOrgId`; `@mwc/shared/roles` gained `grantableRoles` and `mayRemove`, which the members rules' tests hold to the server's own rules for all role combinations; MWC_IDENTITY defaults to `clerk` only for a well-formed `CLERK_SECRET_KEY` (`CLERK_SECRET_KEY_PATTERN`, also the connector's check), and `start` warns by name when a set key is not one, so a placeholder in `.env.local` leaves sign-in off instead of stopping the server; `mwc dev`, `pnpm dev:server` and `pnpm dev:memory` start the API with `--env-file-if-exists=.env --env-file-if-exists=.env.local` (the later file wins, the shell wins over both; `mwc dev` prints only the file names). No frontend tests (the web is typechecked and built); manual smoke with curl: the UI served, `/api/config` and `/api/me` 401.)
12. E2E: owner → invite a `+clerk_test` user → second browser context accepts → member visible → promote → remove → 403. **Done 2026-11-04 as a server-side scenario** (frontend tests are off, so the Playwright e2e waits until Ihor turns them back on; the same story drives the real HTTP API instead; `docs/testing.md`, "S1 acceptance"): `apps/server/test/scenarios/s1-acceptance.test.ts` runs the S1 acceptance through `app.request()` with the fake provider and the jobs loop's real tick (`runJobsOnce`, the clock moved by hand), once per acceptance path, each on a fresh database (PGlite in every lane, Postgres in `--full`): (1) Ihor signs in (`GET /api/me`, no companies), creates a company, and a tick makes its organization (found again by `mwc_company_id`) and turns it active; (2) he invites `second+clerk_test@example.com` as a member and a tick sends the invitation with `mwc_invitation_id`, `mwc_company_id` and the member role; (3) the second person signs up with the ticket, and the server learns it by a signed webhook to `POST /api/webhooks/clerk`, by their first `GET /api/me`, by the periodic reconcile on a tick (the clock moved to the company's next slot), by Sync now, or, for a person signed in already, by `POST /api/me/reconcile`; each path ends with them active as a member in `GET .../members` and the invitation accepted; (4) as a member they read the company and get 403 on invite, rename, sync and the invitation list; (5) Ihor promotes them, a tick pushes `update_role` to the provider, and they can invite (201); (6) they make a personal API key, and `GET /api/me` with it (what `mwc whoami` asks) answers as them, in that company only; (7) Ihor removes them: at once 404 for their session and 401 for their key, and the next tick's `remove_member` removes them at the provider; (8) every change has its audit rows with the actor's principal and the request id, and the acceptance's are the system's; (9) a third company someone else owns answers 404 to all of them on every route tried and is in none of their lists, and theirs answers 404 to its owner, throughout. Helpers in `test/fixtures/acceptance/` (the provider as a target, the world, the steps, the paths, the checks). Two gaps it exposed, closed in this step: a person already signed in who accepted an invitation appeared only after a webhook, the periodic reconcile or Sync now, because `GET /api/me` reconciles once per session, so `POST /api/me/reconcile` (identity module, `service/me.ts`, split from `service.ts`) runs the sign-in reconcile at once for a Clerk session (a pending one too), at most once per person every 10 s per server process (`platform/http/throttle.ts`; otherwise 429 `rate_limited` with `Retry-After`), refuses API keys (403 `forbidden`) and answers what `GET /api/me` answers, and the web's `/accept-invitation` calls it once while it waits for the invited company; and the reconcile paths projected an acceptance without audit rows (only the webhook path wrote them), so the sign-in reconcile, the self reconcile, Sync now and the periodic reconcile now write the same rows, by the system, with the request's id (none for the periodic job, as the jobs' other rows). Real Clerk: `test/scenarios/s1-acceptance-clerk.test.ts` runs steps 1, 2, 3 by the first sign-in, and 7 against the development instance with `pnpm --filter @mwc/server acceptance:clerk` (`CLERK_CONTRACT_TEST=1` and a development secret key; `+clerk_test` emails, a Frontend API sign-in and the ticket sign-up of the S1.2 fixtures, full cleanup), and is skipped otherwise. **Real-Clerk run 2026-11-04: passed** (4 of 4, the first run after the S1.2 slug fix; no `mwc-contract-` users or organizations left). Left to Ihor's walkthrough at the stage review: a real second person accepting by the emailed link, the ngrok webhook hookup (`docs/clerk-setup.md`, "Webhooks"), and the browser click-through of the same story.
13. **Structure review** (`.claude/skills/keep-structure/references/review.md`): `pnpm mwc structure --report` and the open lessons, then at most 5 improvements, each with its evidence, to Ihor before the tag; each one he approves lands as its own commit. **Reviewed 2026-11-05, nothing changed:** five suggestions went to Ihor (count fan-in per module and let the component library groups grow past 12 entries; placement-table rows for scenarios, shared runtime code and web hooks; the members↔identity cycle; the two long functions and `memory-store.ts`; three coverage gaps). He kept the structure as it is for now ("For now it's fine"); the lessons stay `open` for the S2 review.

Added outside the plan: **company logos, 2026-11-05, on Ihor's request** ("Add company logo" on the create-company
page), ahead of the plan's "no photo uploads in v0" (`docs/architecture.md`, sections 7 and 17). Server side:
migration `0004_company_logos` (one row per company, the image in Postgres, at most 1 MB), `PUT`, `GET` and
`DELETE /api/companies/:companyId/logo` (admins and owners change it, any member reads it; the type told from the
file's first bytes, PNG, JPEG or WebP only; `ETag` and a version-keyed `Cache-Control`), `logo: {version} | null`
on company responses and on each membership of `GET /api/me`, and the `logo` audit rows. Logos stay local; syncing
them to the Clerk organization's logo is a possible later step. Tests: the routes, the version in every response,
the audit rows, the table's constraints and its cascade, the type detection.

### S2 — org structure

Done when: a chart with people and agents can be built, moved and read as a tree; invalid moves are refused with reasons; a removed person's reports are re-parented; SLOP BOX exists as an agent definition (coder role, Opus, effort xhigh, instructions) reporting to Ihor.
1. Migration `0002_org`: agents, org_positions (+ reserved `credentials`, `machines` DDL, no API yet); zod contracts for S3–S5 tables in `@mwc/shared`. **Done 2026-11-05** (migration `0005_org`, the next free number: `agents` (a tenant table with `UNIQUE(company_id, id)`; `principal_id` a composite key to `principals`, one agent per principal, the principal's kind `agent` left to the org service since a CHECK cannot read another row; `name` and `role_title` 1–80 characters; `slug` the company slugs' kebab rule, unique per company; `status` active|paused|archived, `harness` claude_code|codex, `effort` low|medium|high|xhigh|max, mirrored by `AgentStatus`, `Harness` and `Effort` in `@mwc/shared/enums`; `model`; `instructions` with `instructions_rev` ≥ 1; `max_concurrent_runs` 1–8, default 1; `face` 0–41, default 0, the web's drawn `AgentFace`, 7 colours × 6 features; `settings`) and `org_positions` (one per principal, `(company_id, principal_id)` its primary key; `reports_to_principal_id` a nullable composite key to `principals`, never the principal itself; `title` at most 80 characters, none by default; indexed by manager). The rules across rows (no cycles, agents never root, an agent's chain reaches a person, agents never manage people) are S2.2's rules and S2.3's service, not SQL; `packages/db/src/schema/org.ts` says so. The migration's one hand-written part, under `-- custom:`, places every company's active memberships: owners at the root, everyone else under the company's earliest active owner (membership `created_at`, then id), at the root when the company has no active owner; titles null. Creating a company now also writes the owner's root position, in the same transaction (`companiesRepo().addOwner`). Not in this step, on purpose: the reserved `credentials` and `machines` tables and the zod contracts for S3–S5, since `docs/structure.md` adds nothing ahead of its stage (they come with S3–S6), and any API or service beyond the company-create insert (S2.3). Tests: each CHECK at and past its bounds, the uniques, the composite keys refusing another company's or an unknown principal (also through the tenant layer), the tenant layer stamping, scoping, moving and removing positions (`packages/db/test/schema/org.test.ts`); the backfill on a database seeded at `0004` with owners, admins, members, viewers, invited, suspended and removed memberships, an agent principal, a company with no active owner, one without members and two owners who joined at once (`org-backfill.test.ts`, with `test/fixtures/migrations.ts`, `migrateUpTo`, which `migrate.test.ts` now shares); the owner's root position on `POST /api/companies`; the new enums.)
2. Org rules (`apps/server/src/modules/org/rules.ts`): `validateMove`, `nearestPersonUp`, `directReports`, `descendants` — unit: cycles, agent root, agent managing a person, chain not reaching a person. **Done 2026-11-05** (`apps/server/src/modules/org/rules.ts`: pure functions over one company's chart, nodes `{principalId, kind, reportsTo}` (`PrincipalKind` from `@mwc/shared/enums`) whose input order is the stable order of every list returned; the chart model and its walks are in `rules/chart.ts`, the per-principal violations in `rules/violations.ts`; no routes yet, so no `index.ts`. `validateMove(chart, principalId, newReportsTo)` answers `{ok: true}` or `{ok: false, code, message}` with a sentence a UI can show, refusing `unknown_principal` (either id not on the chart), `self`, `cycle` (the new manager is below the principal), `agent_manages_person` (a person under an agent), `agent_root` (an agent moved to the top) and `chain_without_person` (any agent of the moved subtree left without a person above it); the API and the web show these codes. `nearestPersonUp` is the person themselves, or the first person above an agent, and null when there is none, where callers fall back to the company owner (section 11 of the architecture). `directReports` and `descendants` (depth-first) list in chart order. `reparentOnRemoval(chart, principalId, fallbackPersonId)` gives the moves when someone leaves (a removed person, an archived agent): the direct reports go to the leaver's manager; people only to a person (the nearest at or above that manager, else the top), agents to that manager when a person is above it, else to the fallback, the company owner; a fallback that is not a person on the chart, or is the leaver, is not used, and the agents left at the top then show as `agent_root`. `validateChart` lists every broken invariant in chart order, as `{code, principalId, message}`: the move codes but `unknown_principal`, plus `duplicate_principal` and `unknown_manager`. With `applyMoves(chart, moves, removed?)`, the chart after the moves, it is the final guard S2.3 and S2.4 run before writing. `buildTree` nests the chart for `GET /org/chart` as `{principalId, kind, orphan, children}`, each principal once: a principal whose manager is not on the chart, and the first of a loop, are tops flagged `orphan: true`. Every walk ends on loops and missing managers in the data. Tests (`apps/server/test/modules/org/rules.test.ts`, 28, 100% lines and branches of the three files): every refusal code and its message, allowed moves (subtrees, across tops, agents under agents under a person), moving a subtree under a chain with no person, deep chains, two tops, the stable order with the chart reversed, loops and self-reports in the data, duplicates, the re-parent cases (a middle manager, a root person with agent and person reports, archived agents under a person and under an agent, the fallback owner and unusable fallbacks, managers off the chart, loops through the leaver), each checked with `validateChart` after the moves, every violation code, and trees with orphans.)
3. API: agents CRUD (name, slug, role_title, harness, model, effort, instructions, max_concurrent_runs), `PUT /org/positions/:principalId`, `GET /org/chart` — integration incl. cross-tenant and viewer-forbidden. **Done 2026-11-05** (`apps/server/src/modules/org/`, one module as the map has it: `routes.ts`, `schemas.ts`, `service.ts` with `service/` (agents, status, positions, chart, read, audit), `repo.ts`, and the new pure rules in `rules/agents.ts` and `rules/placement.ts` beside S2.2's. Under `/api/companies/:companyId`: `GET /agents` (viewer and up; active and paused, `?status=active|paused|archived|all`; no `instructions`), `GET /agents/:agentId` (viewer and up; with `instructions`, archived ones too; 404 `agent_not_found`), `POST /agents` (admin and up; `{name, slug?, roleTitle, model?, effort?, harness?, instructions?, maxConcurrentRuns?, face?, reportsToPrincipalId?}`, defaults `claude-opus-5-5`, `high`, `claude_code`, `''`, 1, the face `agentFace(slug)` (FNV-1a mod 42) and the caller as manager; principal, agent and position in one transaction; 201 with the agent; 409 `agent_slug_taken` for a chosen slug, a derived one takes `-2`, `-3`, ...), `PATCH /agents/:agentId` (admin and up; any field and `status`; new instructions bump `instructionsRev`; `archived` moves the direct reports with `reparentOnRemoval`, falling back on the earliest active owner, and removes the agent's position; back from `archived` it reports to the caller; no hard delete), `PUT /org/positions/:principalId` (`{reportsToPrincipalId?, title?}`: moving and titling others for admins and up, any active member titles themselves, 403 otherwise; 404 `position_not_found` for anyone off the chart: another company's principal, an inactive member, an archived agent; 200 `{principalId, reportsTo, title}`) and `GET /org/chart` (viewer and up; `{nodes, tree}`, each node `{principalId, kind, reportsTo, title}` with `person: {userId, displayName, email, role}` or `agent: {agentId, name, slug, roleTitle, status, face, model, effort}`, the tree `buildTree`'s; a stored chart that breaks an invariant is still answered with its orphans flagged and logged at warn once per company until its flaws change). The org rules' refusals are 422s with their code and sentence (`unknown_principal`, `self`, `cycle`, `agent_root`, `agent_manages_person`, `chain_without_person`); every change runs under the company row's lock and is refused when the chart afterwards breaks an invariant it did not break before, so a chart already flawed (a removed member's reports, until S2.4) still takes changes that add none. Audit rows per field: `agent` (create, update; the instructions as `instructionsRev`, never their text) and `org_position`, keyed by the principal (create, update, delete). The limits and defaults are `@mwc/shared/org`, which the `agents` and `org_positions` CHECKs now read (no migration: the same SQL); the slug rule moved to `@mwc/shared/slugs`, which the companies' rules re-export. `seedCompany` places the owner at the root and `seedAgent` is new in the testkit. Tests: `apps/server/test/modules/org/routes/` (agents, agent updates, positions, chart) and `rules/` (agents, placement), 46 new (53 with the shared and testkit ones), every file of the module at 100% lines and branches but `service/chart.ts` (90% branches: a missing profile's fallback).)
4. Lifecycle hooks: membership activate → position under the inviter; remove → re-parent; agent archive → re-parent. **Done 2026-11-05** (the org module's `memberChart` in `apps/server/src/modules/org/service/lifecycle.ts`: `placeMember(t, {principalId, invitationId}, by)` and `unplaceMember(t, principalId, by)`, deciding with the pure `rules/lifecycle.ts`: `joiningManager` (the invitation's `invited_by` principal when they are a person on the chart, else the earliest active owner on the chart other than the person, else the top; owners included) and `leavingPlan` (`reparentOnRemoval` with the earliest other owner as the fallback, and the invariants the chart then breaks that it did not). Every path calls it in the membership's own transaction, under the company row's lock: the database identity store's `upsertMembership` on any change into or out of `active` (so the webhook events, a deleted user included, the reconcile on sign-in, `POST /api/me/reconcile`, Sync now, the periodic reconcile, a suspension and a re-activation; `identity/repo/memberships.ts` with `repo/chart.ts`) and the members module's removal (`members/service/remove.ts`). `createApp` and `moduleJobs` pass it to the identity and members modules as `ChartDeps`, a port the identity module defines, so neither imports the org module (which already imports the identity service) and no module cycle is added; the in-memory identity store and the store contract have no chart. Placing twice changes nothing (a person with a position keeps it, also one left behind before S2.4); a removal is never refused for the chart: the last-owner guard keeps an owner for the agents to fall back on, and a flaw a removal at the provider leaves (the only owner gone, their agent at the top) is written and logged at warn. Role changes and a company's soft delete move nobody, and a membership ending in a deleted company leaves its chart as it is. Audit rows `org_position` `create`, `update` and `delete`, by the member who removed someone with the request id, or by the system with the delivery id or the reconcile's request id (none for the periodic one); a place at the top is now recorded too (`reportsToPrincipalId` null to null). S2.3's `service/status.ts` (an agent archived or restored) moved into `service/lifecycle.ts`, one file for every principal joining or leaving the chart, whose archive writes its moves through the same `takeOffChart`. Tests: `apps/server/test/modules/org/rules/lifecycle.test.ts` and `test/modules/org/service/lifecycle/{place,unplace}.test.ts` (each of the five paths places under the inviter, falls back on the earliest owner when the inviter has left, changes nothing on a second run, and re-parents a person's people and agents on a removal at the provider; the remove route with a middle manager, a root owner with an agent and the last-owner guard; a person deleted at the provider; suspend and re-activate; the only owner removed; role changes; soft delete); the S1 acceptance now follows the chart on each of its five paths (the invitee under Ihor, an agent they make moving up to him when they are removed), and the identity tests that list audit rows include the position's.)
5. Web: org chart page, agent form, person title edit. **Done 2026-11-05** (`apps/web`; the rail's Agents is live, right after Overview. Routes: `/:slug/agents` with the tabs Org chart and Agents (`?view=list`), `/:slug/agents/new` (hire; admins and owners) and `/:slug/agents/:agent` (an agent by its slug, or by its id when its slug is `new`; editable by admins and owners, read-only for members and viewers), the pages `AgentsPage` and `AgentPage` thin over their parts. The library group `components/org/` (with a barrel): `OrgTree`, a chart top to bottom from 40rem with connector lines, where reports that have no reports of their own stack under their manager so a team stays narrow, several tops side by side and a sideways scroll past the page's width, and on phones an indented list of the same cards; `OrgNodeCard`, a person with their picture or blue initials, name or email, title and role badge, an agent with the teal accent, its drawn face (muted once paused), role, status pill and model with effort in small type; `PrincipalSelect`, the managers grouped people then agents, the places the org rules refuse shown disabled with the reason (below the subject, an agent for a person); `chart.ts` and `agent-labels.ts` (models, efforts, harnesses, `agentRef`). The page's parts in `features/agents/`: each card's menu (Reports to… for admins, Edit title for admins or oneself, Open agent), editing in the card with `PUT /org/positions` and the server's 422 sentence inline; the list (`DataTable`; Active, Paused, Archived, All); the agent form (name and the handle it makes, role title, the 42 faces with the name's face until another is picked, a model of four or a custom id, effort, harness with Codex shown for later, runs at once 1–8, reports to with the signed-in person first, instructions in monospace with their length), with a live preview of the card on the chart while hiring and a bar kept in view with the form's buttons; the agent's page (Pause or Resume, Archive confirmed in place, Restore; the instructions' revision; Save sends the changed fields with `PATCH` and a new manager with `PUT`). The company shell loads the team once (`useCompany().agents`, reloaded after a change; `api/org.ts` holds the hooks and calls): the Overview's teal card counts it with its faces (Hire your first agent for admins when there is none), and the Quick create dock shows its faces with the words and the send button disabled, "Tasks arrive in S4". Library changes: `StatusPill` knows paused and archived; `Select` takes groups and disabled options; `SegmentedControl` disabled choices with a note and a read-only state; `ChoiceField`; `Menu`'s `floating` panel fixed to the window (`useFloatingPanel`), for triggers inside the scrolling chart; `SkeletonRows` (the members' `TableSkeleton` moved), `Skeleton` `inverse`, `AvatarStack` ids; `companyNav` builds the rail for the company and the gallery alike. Gallery: `/design/org` only (three people and five agents, a PM agent over two agents, one paused, one archived; `?view=list`, `?agent=new`, `?agent=vega`). No frontend tests, by the rule: typechecked in `mwc check` and built.) **Addresses without `/c/`, 2026-11-05** (Ihor's request): a company's pages are `/<slug>/...`, every link built by `companyPath` (`apps/web/src/app/nav.ts`); an old `/c/<slug>/...` link is replaced by `/<slug>/...`, and a first segment that is no company of the person's, or one the app keeps, shows the not-found page. The kept words are `RESERVED_SLUGS` in `@mwc/shared/slugs` (the web's and the server's first path segments, now and planned): the API refuses a chosen one with 422 `slug_reserved` on create and rename, a derived one takes its next suffix (`Settings` → `settings-2`), and the address fields say so as you type. Tests: the shared list, the refusals and the derived suffix, and the server's web test (deep links at `/<slug>/...` load the app; every first segment of the OpenAPI paths and of the web's route table is reserved).
6. CLI/MCP thin: `mwc org tree`, `mwc agents list`; `@mwc/mcp` exposing `me`, `org_chart`, `agents_list`. **Done 2026-11-05** (`mwc org tree [--company <slug>] [--json]`: the chart as an indented tree, people as name (else email) · title · role, agents as `◆` name · role title · status · model/effort, `[orphan]` after a top whose manager is off the chart; `mwc agents list [--company <slug>] [--status active|paused|archived|all] [--json]`: an aligned table with whom each agent reports to by name (from the chart). Both take the saved login or `MWC_SERVER` + `MWC_API_KEY` (and `--server`), check the key with `GET /api/me` and act in the company `--company` names, else the saved login's, else the only one, refusing with the slugs the key reaches; plain text, never coloured; exit 0, 1 (not logged in, refused, any API error with the server's message), 2 (usage). What they share with the MCP server is exported from the CLI: `@mwc/cli/api/client`, `/api/org`, `/api/session`, `/org/render`. `packages/mcp` (`@mwc/mcp`): a stdio MCP server on `@modelcontextprotocol/sdk` 1.32.1 (`McpServer.registerTool`, zod input schemas, read-only annotations) with `me`, `org_chart` (tree text and compact JSON nodes) and `agents_list` (table and compact JSON), the login read on every call from `MWC_API_KEY` with `MWC_SERVER_URL` (or `MWC_SERVER`), else the `mwc login` file through `@mwc/cli/credentials`; refusals are tool errors with the server's message; the entry `src/main.ts` is exempt from coverage like the other entries. Adding it to Claude Code is Ihor's step (`docs/mcp.md`). `@mwc/testkit` gained `seedMember` and `seedApiKey`. Tests: both commands and every tool against the real API (`createTestApp()` reached in-process through `app.request()`), text and JSON, the company choice (one, several, unknown), refusals and usage errors; the tools through an SDK client on the in-memory transport, the stdio transport on in-memory streams, the environment against the credentials file with temporary folders.)
7. **Structure review** (`.claude/skills/keep-structure/references/review.md`): `pnpm mwc structure --report` and the open lessons, then at most 5 improvements, each with its evidence, to Ihor before the tag; each one he approves lands as its own commit.

- **User profiles** (2026-11-05, Ihor's request: "the ability to ADD a photo, and while creating an account set some main properties, first and second names, so it's shown NOT AS AN EMAIL"). **Done 2026-11-05** (migration `0006_user_profiles`: `users.display_name` may be null (`image_url` was there since `0000`), and the stand-ins stored for a person without a name, the email's part before the @ or a blank, are cleared under `-- custom:`. The Clerk connector's `displayName` is the first and last name, trimmed, or null, and `imageUrl` is set only when Clerk's `has_image` says so; `ExternalUser`, `StoredUser`, the fake (`displayName: null`, `updateUser` taking a name or photo away) and the provider and store contracts follow. The webhook, the reconcile on sign-in (of a person seen before too, at their next session) and `POST /api/me/reconcile` refresh both; `GET /api/me`, the member list, the API keys' owners and the org chart's person nodes (now with `imageUrl`) answer `displayName: null` for a person without a name. Web: `/onboarding` ("Tell us who you are", first and last name required, an optional photo cropped round; asked before any other page while the name is missing, so right after Clerk's sign-up), `/profile` (change both later, remove the photo), the top bar's user pill with the person's photo or initials, name and role and a menu (Your profile, Manage account, Sign out), and the photo on the `Avatar` (initials when it fails to load), on the org chart's person cards (from the chart itself), the members table, the "Signed in as" lines and the greeting's first name. Tests: the mapping with and without names and `has_image` true and false, the refresh on each path (Clerk payloads through the webhook route), the new response fields, the migration's data step, the CLI and MCP naming a person without a name by their email.)
- **Agent icons** (2026-11-10, Ihor's request: "I wanna assign icons to the agents"). **Done 2026-11-10** (migration `0019_agent_icons`: `agents.icon_kind` face|emoji|image and `agents.icon_emoji`, and the tenant table `agent_icons` for the image bytes, shaped as `machine_logos`; `PUT` (an image: PNG, JPEG, WebP or GIF, at most 1 MB, told by its first bytes), `PATCH` (`{kind: 'face'}` or one emoji), `GET` (the image, ETag and a version-keyed cache) and `DELETE` (back to the face) of `/api/companies/:companyId/agents/:agentId/icon`, admins and owners change it, any member reads it; `icon` on every agent view and the chart's agent nodes; the `icon` audit rows. Web: `AgentIcon` in the component library everywhere an agent's face showed (the org chart's cards follow once they are rebuilt), and the agent form's icon picker with Face, Emoji and Image. Details: `docs/architecture.md`, section 7, "Agent icons". Tests: the routes (each type, the refusals, emoji validation, roles, another company's agent, the versions in the views and the chart, the audit rows), the rules, the shared emoji check, the table's constraints and its cascade.)
- **Structure: S2.8 org chart canvas, drag and drop, add from the chart** (2026-11-10, Ihor's request: "I would love to have a possibility to invite people, assign managers, Add agents etc... drag and drop on such a chart Agents to reassign them to another teams"). **Built 2026-11-10** (chart only; no tasks or processes yet). The chart's pure rules moved from the org module to `@mwc/shared/org-chart` (with their tests), plus `addedViolations` and `moveVerdict`, the verdict `PUT /org/positions` gives (`validateMove`, then no invariant the move adds), so the server and the web decide with one implementation. Web: the Org chart tab is a canvas (`components/org/ChartCanvas.tsx`, `layout.ts`, `ChartCard.tsx`, `CompanyCard.tsx`, `ChartLines.tsx`; `features/structure/`): the company card on top, people (blue) and agents (teal, their icon with a status dot, harness, model and effort, machine) as compact cards of one size, elbow lines with rounded corners, managers centred over their teams and four or more reports without reports of their own hung in two columns on a spine; pan by dragging the background, the wheel or the arrow keys, zoom with + and −, Ctrl/⌘ and the wheel or a pinch, fit to screen, the view remembered per browser and canvas width (a phone starts at a zoom that can be read). Admins and owners drag a card (pointer events: a mouse after a few pixels, a finger after a long press; Escape cancels; the canvas pans at its edges) onto another card or onto the company (the top): valid places dashed blue, the refused ones dimmed with the rules' sentence under the pointer; the drop moves at once, `PUT /org/positions` makes it, a refusal rolls back with the server's message, and a toast says "Moved X under Y" with Undo. Each card's + (and its ⋯) hires an agent under it (`/agents/new?reportsTo=`, prefilled) or invites a person under a person or the company (`reportsToPrincipalId`, migration `0020_invitation_manager`, checked with the org rules at invite time and taken by `placeMember` while still a person on the chart); its ⋯ opens the agent or People, changes the manager (the `PrincipalSelect` picker, the keyboard way to every move) and the title, pauses, resumes or archives an agent, and changes a person's role. Members and viewers read the chart. `GET /org/chart` adds a person's `membershipId` and an agent's `harness`. Tests: the shared rules (with `moveVerdict`), the invitation's manager (kept, audited, listed, null, 422 for an agent and for anyone off the chart, the role rules first), placement under it on all five learning paths and the fallback when the manager left, the db key; no frontend tests.

- **S2.9 notifications** (2026-11-10, Ihor's request while restructuring the chart: "There will be needed notification that you have been reassigned/suspended etc... via email"). **Built 2026-11-10 on the `notifications` branch, not merged yet** (docs/notifications.md; migration `0020_notifications`, after `0019_agent_icons`: the tenant tables `notifications` and `notification_settings`). A new module `apps/server/src/modules/notifications/` writes a change's notices in the transaction that makes it: a move on the chart to the moved person and both managers (and a leaver's reports to them and their new manager), an agent paused, resumed or archived to its manager, a role change, suspension, reactivation or removal to the person, an accepted invitation to its inviter; never to the actor, never to an agent. The org and members services call it; the identity store calls it through its `MemberChart` port (`noticeChange`, composed in `app.ts`). `GET /api/companies/:companyId/notifications` (mine, paged, with the unread count), `POST .../notifications/read` (ids or all), `GET/PUT .../notifications/settings` (email on or off, per person and company, on by default). Email: the `EmailSender` port in `platform/email/`, the development outbox (`.data/outbox/*.eml`, `mwc dev outbox`), MWC_EMAIL `outbox` in development and `off` elsewhere; **SMTP is not built yet** (`MWC_EMAIL=smtp` is refused at startup; `MWC_SMTP_URL`, `MWC_EMAIL_FROM` are read). The jobs loop's `notifications` job sends each person one email per quiet minute (five at most), retried with the jobs' backoff and given up after 12 tries, skipping what was read in the app first. Web: the top bar's bell shows the unread count and opens the panel, with the email switch; it refreshes every minute. Tests: rules, words, routes, each trigger through the API and the identity store, the delivery on the test clock, the outbox, the CLI command.)
- **Next for the structure, not built yet** (2026-11-10, Ihor): **Processes**, an idea he will show, which ties into the tasks (S5.3): each team or agent gets its own local task tracker; and **an agent knowing its place**: whom it reports to and which project it is part of, in its instructions and its tools. That second part waits until three agents exist and he has worked out how they work together. The structure (S2.8, S2.9, agent icons) comes before S5.3's tasks.
- **Agents know their place** (2026-11-11, Ihor approved it once his first team was on the chart: the DEVBOX Platform Coordinator with Developer, QA and Code Reviewer, and Codex Tests). **Built 2026-11-11 on the `agent-briefing` branch, not merged yet** (docs/harness.md "Standing instructions"; no migration). Every turn and terminal carries standing instructions (`TurnSpec.instructions`, optional): the agent's briefing, generated from the live chart by `agentBriefing` of `@mwc/shared/agent-briefing` (who it is, its manager, the chain up, its teammates, its reports; paused agents marked, archived ones left out, no emails or ids), then its own instructions, which no turn carried before. Read per turn, so a move on the chart reaches a chat's next turn, resumed. Claude Code: a private `--append-system-prompt-file` with `--system-prompt-snapshot off`; Codex: the Codex home's `AGENTS.override.md`, which Codex re-reads and diffs per turn. `GET /api/companies/:companyId/agents/:agentId/briefing` (viewer and above); the agent page shows it read-only above the instructions ("From the company"), the Hire page previews it. Machines need Update runner to deliver it (an older runner ignores the field). Its project and its tools (the second half of the line below) are still to come. Tests: the pure function, the spec field, both drivers, the runner's private files, the route, the turns and the terminal on the fake runner.

### S3 — subscriptions, access profiles and the limits widget

Reordered on 2026-11-05 with Ihor (design: `docs/subscriptions.md`): the credential store moves here from the old S6,
machines and runner become S4, runs S5, the inbox and the SLOP BOX milestone S6; GitHub and Jira sign-ins join S7.
Notes written before that day that say S3, S4 or S5 mean S4, S5 or S6.

Done when: Ihor signs in with Claude (and with OpenAI) once, from the app, and the login's token and config are stored
encrypted under him; a pasted setup-token, API keys and a gateway can be added too; secrets are never shown back and
need his Clerk session to manage; he bundles them into access profiles and gives a profile to an agent; the home page
shows each subscription's live 5-hour and weekly limits.
1. The credential store: `MWC_MASTER_KEY` (a generated `.data/master.key` in development), AES-256-GCM with AAD and key versions, personal `credentials`, the write-only API for the pasted kinds (setup-token, Anthropic and OpenAI keys, gateway), session-only management, audit — tests: tamper, wrong owner, key version, API keys refused. **Done 2026-11-05** (`MWC_MASTER_KEY` in `@mwc/shared/config`, required in production; in development `.data/master.key` made once (32 random bytes, 0600, never overwritten), with NODE_ENV=test a key in memory; `apps/server/src/platform/secrets/`: the `Keyring` (versions → keys, version 1 the master key) seals and opens with AES-256-GCM, a random 12-byte IV, a 16-byte tag and the AAD `credential|<id>|<owner>|<kind>`, and prints as its versions only. Migration `0007_credentials`: the personal tables `credentials` (owner, kind, label 1–80, account email and non-secret `account_meta`, status, `key_version`, `iv`, `auth_tag`, `ciphertext`, `last_used_at`) and `credential_uses` (each server-side opening, kept after a removal), reached only through `owned(db, userId)` of `@mwc/db`, the personal layer beside `tenant()`. `apps/server/src/modules/credentials/`: `GET`/`POST /api/me/subscriptions` and `PATCH`/`DELETE /api/me/subscriptions/:credentialId` behind `personalRoute` (`platform/auth/personal.ts`: a session only, an API key 403 `session_required`), metadata only in every answer, another person's subscription 404, light format checks and no provider call; audit rows (create, label change, delete) with no company and no secret; the secret shapes per kind (`schemas/secrets.ts`, the logins permissive) and the internal service `credentialSecrets(deps)` with `storeCredential(input)` and `useCredentialSecret(credentialId, ownerUserId, purpose)`, which records each use. The logger blanks secret keys (`REDACTED_PATHS`). Tests: seal/open, tampered ciphertext, IV and tag, another id, owner or kind, an unknown key version, the dev key file, production without a key, the API (isolation, API keys, each 400, no secret in answers, audit rows or logs), uses recorded.)
2. The sign-in helper and **Sign in with Claude** / **Sign in with OpenAI**: the official CLIs' logins in a throwaway sandbox, the code pasted back for Claude, the resulting token and config stored encrypted — tests with a fake helper; Ihor's first real sign-in is the check. **Done 2026-11-05** (`apps/server/src/platform/processes/login-helper/`: the `LoginHelper` port (a sandbox's output, input, home files, kill), chosen by `MWC_LOGIN_HELPER` in `@mwc/shared/config` (`docker` in development, `none` in production and tests until the server image carries the CLIs, `local` for a Linux server with them): `docker.ts` builds `deploy/Dockerfile.login` on first use (`node:24.21.0-slim`, CA roots, `@anthropic-ai/claude-code@2.1.308`, `@openai/codex@0.163.0`; tagged `mwc-login:<sha256 prefix>`) and runs each login in a detached `--rm` container with no mounts or host environment, `--cap-drop ALL`, `no-new-privileges`, a read-only root, tmpfs home and `/tmp`, memory, CPU and pids limits, the `node` user and `sleep 720` as its backstop, the CLI by `docker exec -i` behind `script -qfec`; `local.ts` the same in a private `mkdtemp` home with an environment made from nothing; `process.ts` the child plumbing, `tty.ts` the pseudo-terminal command. The credentials module: `claude auth login --claudeai` and `codex login --device-auth -c cli_auth_credentials_store=file` (`service/sign-in/flows.ts`), their screens read in `rules/sign-in.ts` (the address only on the providers' sign-in hosts) and their files in `rules/login-files.ts` (`claude_oauth` `{ credentials, account }` named "Claude · <email>" with organization, plan, tier and scopes; `codex_oauth` `{ auth }` with the id_token's email and plan), stored with `storeCredential`; sessions in memory (`service/sign-in.ts`, `service/sign-in/session.ts`): owner-bound, one active per person, 10 minutes, `starting`, `waiting_for_user`, `waiting_for_code`, `completing`, `done`, `failed`, `expired`, `cancelled`, the sandbox killed at every end; `POST`/`GET`/`DELETE /api/me/subscriptions/sign-in[/:id]` and `POST …/:id/code` (`routes/sign-in.ts`), session-only, 409 `sign_in_active`, 503 `sign_in_unavailable`. The pinned CLIs were run in the built sandbox only up to their sign-in address; no sign-in was completed. The logger also blanks the logins' token keys, `pastedCode`, `screen` and `output`. Tests: the docker arguments as pure functions (no mounts, the security flags, no `-t`), the image found, built once from stdin, rebuilt after a failure, Docker missing; the local home and environment; the child plumbing on a fake child; the screens and files with made-up fixtures; every state and transition with a fake helper replaying scripted output and hand-fired timers: the code typed in, storing with the right kind, email, details and name, refusal, timeouts, expiry by timer and by clock, cancel killing the sandbox, a cancel during the store, helper failures; the routes: 201, polling, 409, owner isolation, API keys refused, 400s, `none` 503, the API document, no secret in answers or logs. Ihor's first real sign-in, from the S3.5 page or the API, is the check.)
3. Limits: the usage checks per kind (the usage API, the one-token headers probe, `wham/usage`), token refresh, a cache and the 5-minute floor — tests with a fake provider. **Done 2026-11-05** (`GET /api/me/subscriptions/limits`, personal and session-only, in the OpenAPI document: each of the caller's subscriptions with `source` (`usage_api`, `message_headers`, `none`), `checkedAt`, its windows (`five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet`, `weekly`: label, percent used, reset, reached), the last refusal in plain words and `stale`; docs/subscriptions.md, "The limits API". `apps/server/src/modules/credentials/service/usage/`: `claude.ts` (`api/oauth/usage` with the OAuth beta header; an expiring token refreshed with Claude Code's own refresh call), `setup-token.ts` (a one-token Messages request of `claude-haiku-5-5`, the `anthropic-ratelimit-unified-*` headers, on a 429 too), `codex.ts` (`wham/usage` with `ChatGPT-Account-Id`, windows by length; v1's refresh when the JWT is about to expire), `http.ts` (an injected `fetch`, `AppDeps.providerFetch`, refused under NODE_ENV=test; no redirects, a 10 s deadline, a 256 KiB answer; one retry after a 401), `cache.ts` (the `UsageCache` port, in memory). `service/limits.ts`: a plain request checks only what was never checked, `?refresh=1` what is past its floor (5 minutes, 15 for the probe), one check in flight per subscription, the last good windows kept as stale on a failure, `needs_sign_in` after a second 401 or a refused refresh (and `active` again after a good check). The store gained `replaceCredentialSecret` and `setCredentialStatus` (`service/secret-updates.ts`, audited by the system with no secret). No migration. Tests against a fake provider (`test/fixtures/credentials/providers.ts`): each kind's 200 with missing windows, refresh and re-seal (the new secret opens, the old ciphertext is gone), a refused refresh and a second 401 setting `needs_sign_in`, 403 and 429 keeping the last good windows as stale, the probe's headers on a 200, a 429 and a `rejected` window, the floors, the shared check, `source: 'none'` kinds never opened, owner isolation, API keys refused, `credential_uses` rows, and no token or provider answer in the logs. Not verified live yet: the probe's model id and the Claude refresh call.)
4. Access profiles: personal bundles, `agents.profile_id`, a default per person and company, assignment only by the owner in companies they administer — integration tests. **Done 2026-11-05** (migration `0008_access_profiles`: the personal `access_profiles` with three slots keyed to `credentials`, `agents.profile_id` and `memberships.default_profile_id`, all `on delete set null`; the slot kinds in `@mwc/shared/credentials`; `@mwc/db`'s bridges `ownedIn`, `ownersOf` and `o.tenant` run the personal and tenant layers in one transaction. `/api/me/access-profiles` (credentials module, a session only) lists, creates, changes and removes a person's profiles, slots checked for owner, kind and revocation (422), names unique (409); removing one writes the audit rows of the agents and defaults it leaves in each of the owner's companies. The org module: `profileId` on `POST`/`PATCH /agents` (only the owner gives, signed in, as an admin or owner: 403 `profile_not_yours` / `session_required`, 422 `profile_not_found`; any admin takes it off), the caller's default on hire, `PUT /me/default-profile`, `profile` on agents and the chart's agent nodes, `defaultProfileId` on `GET /api/me`; every S2.4 leave path takes the leaver's profiles off the company's agents in its transaction. Details: `docs/subscriptions.md`, "Access profiles". Tests on every rule, refusal and leave path; no UI yet (S3.5).)
5. Web: the Subscriptions page (cards, Add a subscription with each flow, rename, remove), access profiles, the agent form's profile, and the home page's **Subscription limits** widget. **Done 2026-11-05** (`apps/web`. `/subscriptions` (in `RESERVED_SLUGS`), personal and outside any company, in the plain shell's new `wide` column, from the account menu's **Subscriptions** and the widget's **Manage**; its tabs: **Subscriptions** (one card per subscription: kind badge, status pill, name renamed in place, account and plan, the limits' bars, **Sign in again** on a login that `needs_sign_in`, **Remove** confirmed in place, **Check limits** with `?refresh=1`) and `?tab=profiles` **Access profiles** (each profile's name renamed in place, its Claude, OpenAI and gateway slots as selects of the fitting subscriptions with None, saved at once with the 422s inline, the agents using it as company / agent links, Delete confirmed in place, **New profile**, and per company where the person is an admin or owner a **Default for agents I hire** select, `PUT /me/default-profile`). **Add a subscription** is a sheet (`Sheet`, beside `Drawer` in `layout/`) held by the page or the widget (`useAddSubscription`, `features/subscriptions/sign-in.ts`): Sign in with Claude (recommended) or OpenAI, then a setup-token, Anthropic or OpenAI key, or gateway. A sign-in starts only on the person's click, polls every 2 s, and shows its three steps live (`Steps`): starting; **Open Anthropic sign-in** / **Open OpenAI sign-in** in a new tab with Claude's code field and Continue or OpenAI's one-time code, big, with Copy; storing; then "Signed in as <email>", or why it failed or expired with **Try again**. Cancel, Back and closing the sheet `DELETE` it; a start answered after a cancel is cancelled too; 503 and 409 read "Sign-in isn't available on this server (Docker isn't running?)" and "A sign-in is already open". The paste forms take a name and the secret in `SecretField` (dots, no autocomplete or password manager), or a gateway's address and header rows (values as secrets), cleared after the save; the 400s show inline. The home widget **Subscription limits** on `/:slug` (`LimitsWidget`, the person's own subscriptions across companies): Refresh, Manage and Add a subscription (the same sheet, in place); cards two across from md with the name, the account and an info tooltip ("Live from Anthropic", "Read from the last request's limits", "Live from OpenAI", the checked time), the 5-hour and weekly `Meter` rows ("18% · resets in 1h 56m", "resets Tue, Nov 10, 6:00 PM"), the per-model weekly rows when present, blue, amber from 80%, red when reached, a refusal in plain words with the old values grey when stale; keys and gateways as one "no limits (pay as you go)" line; empty: "Add your Claude or OpenAI subscription to see its limits here". The agent form's **How it works** has **Access profile**: the person's own profiles and None, the hirer's company default when hiring, someone else's shown as "<name> · <owner>" with **Remove** for admins, read-only for members and viewers; the agent's page lists it in its facts and the agents table in a Profile column. Library: `data/Meter.tsx`, `data/Steps.tsx`, `Sheet`, `SecretField` and `SECRET_INPUT` in `forms/Field.tsx`, `forms/InlineEdit.tsx`, `formatDuration` and `formatWeekdayTime`, `ButtonLink` `newTab`, `Tooltip` `wrap` and `bottom-end`, `StatusPill` `needs_sign_in`, `profileLabel`; the drawer's focus no longer moves on a new `onClose`. `api/subscriptions.ts` holds the hooks and calls, `api/types.ts` the inferred shapes, `api/errors.ts` the new refusals' words. Gallery: `/design/subscriptions` only (the widget on a healthy card, one at 85%, one reached, one rate limited and stale, an API key; `?empty=1`). No real sign-in was started. No frontend tests, by the rule: typechecked in `mwc check` and built.)
6. **Structure review** (`.claude/skills/keep-structure/references/review.md`): `pnpm mwc structure --report` and the open lessons, then at most 5 improvements, each with its evidence, to Ihor before the tag; each one he approves lands as its own commit. **Done 2026-11-06** (68 warnings, 44 of them `fan-in`; Ihor approved all five: `fan-in` skips type imports, counts a server module once and leaves out the web's library, `api/` and `app/` (bc330a5); the web's page parts moved to `apps/web/src/features/` (fc81548); folders that grow by design warn at 20, the server's test fixtures grouped by module, the db diagram in its folder (0f3be90); the placement table covers the cases the lessons found (7c37c07); the settled lessons moved to `lessons-archive.md`, `lessons.md` from 778 lines to 58. The report ends at 19 warnings.)

### S4 — machines, runner, power and stats

Reshaped on 2026-11-06 with Ihor (design: `docs/machines.md`): one runner on every machine (This Mac, a Docker
container, the Airia devbox), the server decides and the runner acts; keeping machines awake, the devbox's power
through the official `airia` CLI on This Mac, and machine stats on the home page. The signed self-update moved to S8.

Done when: runners on This Mac (launchd), in a compose container and on the devbox show online on the Machines page and
on the home page's Machines board with live numbers, survive a server restart, go offline on disconnect and come back;
the devbox starts and stops from the page, its keep-on hours hold it up, This Mac stays awake while held.
1. Runner protocol (+ hold, power and stats messages), the shared zod contracts (power policy, samples) and the testkit
   fake server / fake runner — unit: zod round-trips, protocol fixtures. **Done 2026-11-06** (`@mwc/shared/runner-protocol`:
   21 frames, camelCase, parsers and limits; `@mwc/shared/machines`; `@mwc/testkit/runner`; reference `docs/runner-protocol.md`.)
2. Server: migration `0009_machines` (machines, enrollment tokens, runner sessions, samples, power, power events),
   enrollment, the WS hub, samples ingest and the 7-day prune, the machines and stats API — integration on PGlite with
   `ws`. **Done 2026-11-06** (migration `0009_machines`; `POST machines/enrollment-tokens`, `POST /api/runner/enroll` (`RunnerEnrollRequest/Response` in `@mwc/shared/runner-protocol`); the runner hub on `/api/runner/ws` (`modules/machines/service/runner/hub.ts`: sessions, samples, holds, `request()` for `power.command`); `GET/PATCH/DELETE machines`, `GET machines/stats`; the offline sweep and the hourly 7-day prune; a removed machine keeps its row (`removed_at`). Tested over a real socket with `FakeRunner`; `--full` green.)
3. `apps/runner` core: config, state dir, link and reconnect, heartbeat with the sampler, the hold drivers
   (`devbox-keepalive`, `caffeinate`), health :9953 — runner vs fake server: survives a server restart. **Done 2026-11-06** (`apps/runner`, `@mwc/runner`: config `@mwc/runner/config` (0600), the link with handshake, heartbeats every 20 s with a sample a minute, reconnect with backoff, exit codes 76/77/78, hold drivers `devbox-keepalive '20 minutes'` / `caffeinate -i -w` / none, `/healthz` on 9953; 146 tests against `FakeRunnerServer` on fake time.)
4. Power: `packages/machines-core` (the power driver port) and `connectors/machine-airia-devbox` (`airia devbox
   up|stop`, `gcloud … describe|add-metadata`); the server's power rules, scheduler, power API, controller routing and
   events log. **S4.4a done 2026-11-06** (`@mwc/machines-core`: the `MachinePowerDriver` port, `BoxRules`, `MachinePowerError`, `FakePowerDriver`; `@mwc/machine-airia-devbox`: `airia devbox up --no-wait` / `stop`, `gcloud` describe / list / add-metadata through an injected `run`, acting only on the signed-in account's own `dev-<slug>`; tested with a fake `run` and hand-written GCE JSON.) **S4.4b done 2026-11-06** (`rules/power.ts`: keep-on windows across midnight and DST, once-per-window start where a manual Stop sticks, stop or `kept` at the end; the minute scheduler in the machines jobs sends `machine.hold` on change and on connect, picks the box's controller, checks the box every 5 min; `GET/PUT machines/:id/power`, `POST …/power/start|stop|timezone`, `GET machines/:id/events`; the runner's `airia_devbox` executor, on when `airia` and `gcloud` are found.)
5. `mwc runner install` (launchd / systemd user unit / container) + `mwc machine enroll-token` + compose `runner-local`
   + `deploy/Dockerfile.runner`. **Done 2026-11-06** (one-file runner `apps/runner/dist/runner.mjs` with `enroll|install|status|uninstall` (launchd, systemd user + linger, a container's first-boot enroll; the devbox detected through the GCE metadata server); `GET /api/runner/install.sh` and `/api/runner/runner.mjs` (sha256 checked); `publicUrl` in `/api/config`; `mwc machine enroll-token`; `Dockerfile.runner` and compose `runner-local` (profile `runner`). Nothing installed yet: the live installs are with Ihor.)
6. Web: the Machines page (machines, Start/Stop, power settings, the box's rules, the log, Add a machine) and the home
   page's Machines board. **Done 2026-11-06** (`/:slug/machines`: cards with stats, devbox Start/Stop with its cost, power settings, the box's rules and the time-zone fix, the log, rename, remove, **Add a machine** with the exact install commands; the home **Machines** board with sparklines and up/down bars; library `Sparkline` and `UpDownBar`.)
7. Placements: an agent's machine and mode (`host` folder or a fresh `container` per run) on the agent form. **Done 2026-11-06** (migration `0010_agent_placements`; `GET/PUT/DELETE agents/:agentId/placement` in the machines module; `placement` on agents and chart nodes, `agentCount` on machines; the agent form's **Where it runs**, "Runs on" in the facts, a Machine column.)
   **Devbox link over the airia SSH tunnel, done 2026-11-07** (no public URL: the install runs `airia devbox ssh -- -R …` from This Mac;
   This Mac's runner holds each running box's reverse tunnel over IAP from `tunnel.set` and reports `tunnel.state`, shown on the card.)
   **Machine terminal (server and runner), done 2026-11-09** (owner-only one-time tickets, `GET /api/terminal/ws` relayed over the runner's link as `terminal.*` frames,
   PTY sessions in the runner from prebuilt node-pty shipped beside the bundle, `caps.terminal`; docs/machines.md "Terminal"; the web's xterm.js panel is the next step.)
   **The server drives the airia CLI itself, done 2026-11-09** (MWC_LOCAL_POWER `auto|on|off`: with `airia` and `gcloud` on its computer the server powers every devbox in-process and holds their tunnels with the supervisor now shared from `@mwc/machines-core/tunnels`;
   runner controllers get an empty `tunnel.set` then; one `PowerControl` seam in `service/power/control.ts`; `controller.kind` and `localPower` for the card and the install hint.)
   **Machine logos, done 2026-11-09** (migration `0011_machine_logos`; `GET/PUT/DELETE machines/:machineId/logo` as the company logo's, `logo` on machines and stats rows; the logo on the card's tile and the home board, changed by admins with the company logo's picker; docs/machines.md "Logos".)
   **Container runners with limits, done 2026-11-09** (the add sheet's Docker container form: name, CPUs 0.5–16, memory 1–64 GB, runs at once 1–8; compose `cpus`, `mem_limit`, `pids_limit`, `MWC_RUNNER_SLOTS`; one compose project per container, `-p mwc-runner-<slug>`; `composeFile` in `/api/config` so the command works from any folder; the sampler measures a container against its cgroup v2 limits; docs/machines.md "A runner in a Docker container".)
   **Update runner, done 2026-11-09** (`runner.hello` says the build (its bundle's SHA-256) and `caps.selfUpdate`; `runner` on machines with `current`; `POST machines/:id/runner-update`: `runner.update` over the link (download, SHA-256 check, swap, exit 75) or, for a devbox runner too old for it, the server's SSH reinstall; the power log says when a start or stop found the box already there;
   "Runner out of date" and **Update runner** on the card; docs/machines.md "Updating a runner". It trusts the server over the authenticated link and checks SHA-256 only: the signed self-update stays in S8.)
   **Update container, done 2026-11-10** (a container's runner is updated by rebuilding it: with MWC_LOCAL_DOCKER the server finds the container by `caps.containerId` or its compose project, answers 202 and runs `docker compose … up -d --build runner-local` in the background with its limits and settings; `runner.job.progress` and `runner.updateFailure`; the card's Software part offers **Update container**, first also when a CLI install needs a newer container runner; the Machines page reads the machines again every minute, every 3 s during a job; docs/machines.md "Updating a runner".)
   **Container Start and Stop, done 2026-11-10** (Ihor: "I do not have STOP button for a Container... at least command to be available": the same `power/start|stop` routes and power log serve a container; with MWC_LOCAL_DOCKER the server runs `docker stop -t <grace>` / `docker start` on the container it finds as for the rebuild, holding the job lock, a Stop refused during live work unless forced; without Docker or without a container, 409 with the command; `GET …/power` says Docker's state, so the card says Stopped rather than Offline; Start / Stop next to Details and in the Power part; docs/machines.md "Starting and stopping a container".)
8. **Structure review** (`.claude/skills/keep-structure/references/review.md`): `pnpm mwc structure --report` and the open lessons, then at most 5 improvements, each with its evidence, to Ihor before the tag; each one he approves lands as its own commit. **Done 2026-11-09** (all 5 approved: `features/machines/` split into `card/`, `power/`, `add/`; the runner's top level grouped and its placement block; the machines `service/runner/` and `platform/processes/`; folder limits of 20 for shared and the web's `api/`, mirrored test folders; fan-in leaves out `platform/http/` and the db schema. The report went from 38 warnings to 24. Tagged v0.5.0.)

### S5 — tasks, threads, runs

First: how a run receives its credential (`docs/subscriptions.md`): a short test of the relay (a run token, the server swapping in the real credential), with handing it to the run's environment as the fallback.

Done when: a message to a task assigned to an agent starts a run on its machine, events stream to the thread, the reply is posted; a second message resumes the same session id; Stop works; `kill -9` of the runner and a server restart mid-turn both recover; the chaos scripts pass with the fake `claude`.
1. **S5.1a, the harness drivers: done 2026-11-09** (`docs/harness.md`; pure, nothing spawned, no real turn run). `@mwc/shared/harness`: the wire contracts `TurnSpec`, `TerminalSpec`, `HarnessCredential`, `HarnessGateway`, `TurnEvent` (session, text, tool, tool_result, usage, notice, result). `@mwc/harness-core`: the `HarnessDriver` port (`turn`, `terminal`, `parser`, `versionArgs`), `ProcessSpec` (the prompt on stdin, `unsetEnv`, a private `CODEX_HOME`, notices), `LineParser`, `HarnessError` (`credential_mismatch`, `invalid_spec`), and `/fake`: `FakeHarnessDriver`, fake specs and the fake binary. `@mwc/harness-claude-code` (`claude -p --output-format stream-json --verbose`, `--resume`, `--model`, `--effort`, `--dangerously-skip-permissions`; denials as notices) and `@mwc/harness-codex`, moved here from S7 (`codex exec --json` and `codex exec resume`, sandbox and approvals as config overrides, the login as a private `auth.json`, a gateway not used yet with a notice); each with five recorded-style fixtures as `/fixtures`, flags checked against `claude` 2.1.319 and `codex` 0.162.1. Next in S5.1: the runner runs them, a chat turn streamed and the terminal on the conversation. The real permission-tool round trip is recorded once with the installed CLI in S6.
   **S5.1b, chats with an agent: done 2026-11-09** (`docs/harness.md` "How a turn runs"; Ihor's choices of that day: the
   agent's placement and access profile, a per-chat profile picker, the credential sent with each turn over the runner's
   link after the server refreshed it, Claude Code and Codex, chat mode and terminal mode). Migration `0012_chats`:
   `chats` (bound to the agent's harness and its placement's machine at creation; an own profile only its owner sets;
   the session id from the first `session` event; the title from the first prompt), `chat_turns` (one queued or running
   per chat, the profile and credential each ran on, reply, error, usage) and `chat_events` (`(company_id, turn_id,
   seq)`), and `credential_uses` naming the company, agent, chat and principal of a chat's use. The chats module: the
   chats API, turns (`POST …/turns` 202, stop, every refusal naming what to fix), the credential resolved through the
   credentials module (a Claude login refreshed under 60 minutes left, a Codex login like its usage check, a rewritten
   `auth.json` sealed again), the stream (Server-Sent Events with `Last-Event-ID` replay and a 20 s heartbeat), the
   chat's terminal (the machine terminal's ticket opening the harness's TUI), and the reaper at the server's start
   (`server_restarted`). Protocol: `caps.harnesses` as versions (old runners' names still parse, as no turns),
   `turn.start`/`turn.stop`/`turn.events`/`turn.end`, `terminal.open.harness`, `terminal.exit.authJson`. Runner
   (`apps/runner/src/turns/`): the drivers wired with the CLIs on its PATH (`claude --version` and `codex --version` asked
   once at start), refusals (`unsupported`, `busy`, `home_missing`, `invalid_spec`, `spawn_failed`, `runner_stopping`),
   detached spawn with the prompt on stdin, batched events, the stop ladder, the private Codex folder (`auth.json` 0600
   only while a process runs, sent back when rewritten), the harness terminal; `deploy/Dockerfile.runner` installs both
   CLIs at the sign-in helper's pins. Tests on PGlite with `FakeRunner` and in the runner with `FakeHarnessDriver` and a
   fake spawn; no real turn. Runners need an update to chat (an old one is refused as `runner_outdated`). Next: the web
   (S5.1c) on this API.
   **S5.1d, the folder browser and the work volume: done 2026-11-09** (docs/machines.md "The folder browser", Ihor: the
   home folder "from the FOLDER selector considering a type of the device; for a container, for sure from a persistent
   volume"). Protocol: `fs.list`, `fs.mkdir` and their `fs.result` (`runner-protocol/folders.ts`), `caps.folders`.
   Runner (`apps/runner/src/folders/`): absolute or `~/` paths normalized, a `..` above `/` refused, `/work` the only
   root in a container (links followed), folders sorted without dot-folders, at most 500 with git and CLAUDE.md marks,
   one new folder 0755. Server: `GET` and `POST machines/:machineId/folders` (admins and owners; 409 `machine_offline`
   and `runner_outdated`, the runner's refusals as 422s in plain words, 504 after 10 s; the new folder audited), with
   the runner's home and `agentsRoot` for the default home. Compose: the `runner-work` volume at `/work`, owned by the
   image's `runner` user. Web: **Browse…** beside the home folder on Where it runs (breadcrumbs, Up, New folder, Choose
   this folder) and the suggested `~/agents/<slug>` or `/work/<slug>` with Use suggested. Tests: the path rules,
   listings and mkdir on a fake file system and on Node's, the commands and the daemon on the wire, the routes on PGlite
   with `FakeRunner` (roles, offline, outdated, refusals, timeout), the compose and Dockerfile assertions. Runners need an
   update to browse; a Docker runner a rebuild (`up --build`) for its work volume.
   **S5.2 dictation: done 2026-11-09** (docs/speech.md). A microphone button in the chat composer: raw PCM through Web
   Audio (not MediaRecorder, which stops when AirPods switch profile), a 16 kHz mono WAV, a level meter and an m:ss
   timer, Esc or a second click stops, Alt+Shift+V toggles, two-minute clips, a microphone picker remembered in the
   browser, the text inserted at the cursor and not sent; hidden unless `GET /api/config` says `speech: true`. Server:
   `POST /api/me/speech/transcribe` (a session or a personal API key; `audio/wav` up to two minutes and 8 MB; 413, 415,
   422, 502, 503 `speech_unavailable`) through `platform/processes/speech/`: whisper.cpp on the server's own computer, a
   warm `whisper-server` on 127.0.0.1:9957 started on the first clip and stopped on shutdown, `whisper-cli` on a private
   temporary file as the fallback, clips with under 300 ms of voice skipped, `[BLANK_AUDIO]` dropped, word timings, the
   audio never logged or kept. Config: `MWC_WHISPER` (auto|off), `MWC_WHISPER_MODEL`, `MWC_WHISPER_LANGUAGE`,
   `MWC_WHISPER_PROMPT`, `MWC_WHISPER_PORT`. Tests: the WAV checks, both JSON answers, the warm server, the CLI and their
   orchestration on a fake spawn, fetch and clock (lazy start, warm reuse, restart, fallback, retry pause, shutdown,
   short and blank clips), the selection on a fake host, the route on PGlite (auth, sizes, types, refusals, nothing
   kept), the config keys; no real whisper run, no frontend tests.
   **S5.2 step 1, richer turn events, Compact and Clear: done 2026-11-09** (docs/harness.md "Events" and "Compact and
   Clear"; the first step of chat parity: status, thinking, subagents, a to-do checklist and a context meter on the chat
   page). `TurnEvent` gains `init` (model, effort, folder, slash commands), `thinking` (≤ 20 000, cut with a marker),
   `context` (the last request's input, cache reads, cache writes, output and the window), `compact` (sizes before and
   after), `todo` (the whole list, ≤ 100 items) and `subagent` (its whole state: `agentType`, description, model,
   background, `running`|`done`|`failed`|`interrupted`, summary ≤ 4000, last step), and an optional `parentId` on
   `text`, `thinking`, `tool`, `tool_result`, `notice`, `todo` and `subagent` for a subagent's own events; old events
   stay valid. `contextWindowOf(model)` in `@mwc/shared` (the Claude 5 family and 4.x, Claude Code's aliases, `[1m]`,
   the GPT/Codex models; unknown → null). Claude Code's parser reads `system/init`, thinking blocks, each main-agent
   message's usage (once per message), `compact_boundary`, `TodoWrite`, Agent/Task calls with `parent_tool_use_id` and
   `task_started`/`task_progress`/`task_updated`/`task_notification`, and `result.modelUsage[].contextWindow`; Codex's
   reads `reasoning` and `todo_list` (no `init` or `context`: Codex says neither). The runner keeps `parentId` on a long
   text it splits. Migration `0013_chat_turn_kind`: `chat_turns.kind` (`message`|`compact`|`clear`, a `clear` turn only
   `done` and on no credential). Server: `POST …/chats/{chatId}/compact` (a `/compact` turn; 409 `nothing_to_compact`,
   `compact_unsupported` for Codex) and `POST …/clear` (a `clear` turn as the thread's marker, the session forgotten;
   409 `turn_running`, `nothing_to_clear`, `chat_archived`); the detail's `init` and `context` since the last Clear, and
   each turn's `kind`. Tests: parser cases for every new event, `parentId`, truncation, dedupe and unknown shapes; the
   new fixtures (`subagent`, `compact`, Codex `plan`); the model table; the routes on PGlite with `FakeRunner` (roles,
   refusals, the session reset, the marker in the detail and on the stream); the migration's CHECKs. No real turn run.
   Next: the chat page's status line, thinking, subagents, checklist and context meter (two web steps).
   **S5.2 step 4, selections: done 2026-11-10** (docs/harness.md "Asking the person", docs/runner-protocol.md "Chat
   turns"). The runner bundle's `mcp` subcommand is a hand-written stdio MCP server with one tool, `ask_user_question`
   (AskUserQuestion's shape: 1–4 questions, a header ≤ 12, 2–8 options, one pick or several); a call goes to the runner
   that started the turn over a private Unix socket (a 0700 folder per turn, a random token) and is answered at once
   ("End your turn now…"). Claude Code turns get `--mcp-config`, `--allowedTools mcp__mwc__ask_user_question` and one
   `--append-system-prompt` line; Codex turns the server as `-c mcp_servers.mwc.*` overrides (verified on 0.162.1 with
   `codex mcp list`; no instruction line). New frame `turn.question {turnId, seq, questionId, questions}`, stored as a
   `question` event; the detail's open `question`; `POST …/chats/{chatId}/answers` starts the next turn with the
   answers in words and marks the question with an `answered` event (409 `question_closed` once answered or after any
   newer turn, a plain message superseding it; 422 `invalid_answers`); no migration. The web's question card (pages,
   radio or checkboxes, Other, filter, number keys, Skip/Next/Send answer; receipt; "answered in a message"). Tests: the
   JSON-RPC, the `mcp` command, the socket and its token, a turn whose fake process asks, both drivers' arguments, the
   frame, and the server's storage, stream, detail and route on PGlite; no real turn run, no frontend tests. Tool
   approvals can ride the same bridge in S6.
   **S5.2 step 6, delivery while the agent works: done 2026-11-10** (docs/harness.md "Delivery while a turn runs" and
   "Open in Claude Code", docs/runner-protocol.md "Chat turns"). The composer stays open while a turn runs: Now, After
   this turn or Interrupt (the last choice remembered per browser). `POST …/chats/{chatId}/turns {prompt, delivery}`
   queues a message (202 `queued`, ten at most: `queue_full`); without a delivery a running turn still refuses
   (`turn_running`). Interrupt stops the running turn and starts first; after every turn's end the next waiting turn
   starts as its sender, resuming the session (a refused one fails in words, the next is tried; an overtaken one is
   renumbered after the last). Now is Claude Code's: every Claude turn now runs with `--input-format stream-json
   --replay-user-messages` (checked with `claude --help` 2.1.321), the prompt the first stdin line, stdin open until a
   settled result; new frame `turn.input {turnId, inputId, text}`, the harness's echo a new `input` event that removes
   the waiting turn; one not taken starts next. Waiting messages: `PATCH`/`DELETE …/turns/{turnId}` and `POST
   …/turns/{turnId}/deliver {now|interrupt}`, listed above the composer; the detail's `queue`; the stream's `removed`.
   Migration `0014_chat_turn_queue` (the one-live index on `running` only, `chat_turns.delivery`). "Open in Claude Code"
   in the chat header: copyable resume commands for a Mac, the devbox (`airia devbox ssh -- -t "…"`) and a Docker
   runner (`docker exec -it … sh -lc "…"`), `codex resume` for Codex (`@mwc/shared/resume`). Tests: the queue rules and
   routes on PGlite with `FakeRunner`, the drain's races, the index, the runner's stdin in input mode, the driver's
   arguments and the parser's echoes, the `input` event and frame, the commands' quoting read back through `/bin/sh`; no
   real turn run, no frontend tests.
   **One maintenance job per machine: done 2026-11-10** (docs/machines.md "One job at a time"): installs and runner
   updates lock each other out (409 `machine_busy` naming the job; in memory, released on the end, the reconnect or a
   timeout), a runner update waits for running chat turns and terminals unless forced, the runner refuses the same
   (`busy`), `GET machines` gains `runner.job` and `runner.live`, and the card disables its buttons with the reason.
   **Chats load lazily: done 2026-11-10** (docs/harness.md "Reading a long chat"): the detail holds the current
   conversation (its latest 30 turns) and `earlier`; `GET …/chats/{chatId}/turns?beforeSeq=` pages older turns; the
   page folds each conversation before a Clear into a bar and loads older messages on scroll; no migration.
   **Access profiles of one provider: done 2026-11-10** (docs/subscriptions.md "Access profiles"; Ihor: one provider per
   profile, so several profiles can use different subscriptions of one provider). Migration `0015_profile_provider`:
   `access_profiles.provider` (`claude` | `openai`, fixed), one `credential_id` and `gateway_credential_id` (a CHECK: a
   gateway only on a Claude profile), the slot columns dropped; `memberships.default_claude_profile_id` and
   `default_openai_profile_id` replace `default_profile_id`. Its `-- custom:` data step splits a bundle of both
   subscriptions into the Claude profile and a new "<name> · OpenAI" one that takes its OpenAI subscription, its Codex
   agents and chats and the OpenAI default of members whose default it was; single-provider and empty profiles keep
   their rows; agents and chats left on a profile of the other provider lose it; audit rows by the system. Routes:
   `POST /api/me/access-profiles {name, provider, credentialId?, gatewayCredentialId?}`, `PATCH` keeps the provider
   (422 `provider_mismatch`, `gateway_not_allowed`); a profile given to an agent or chosen for a chat matches its
   harness (422 `profile_harness_mismatch`), a harness change takes a misfit off with `profileCleared` in the answer;
   `PUT /me/default-profile {provider, profileId}`; a turn refuses `profile_harness_mismatch` and `profile_empty`.
   Web: the profiles in Claude and OpenAI groups, New profile asking the provider first, a default per provider, the
   agent form and the chat picker offering only matching profiles, "Make one" opening New profile for that provider.
   Tests: the backfill seeded at `0014` (each case, agents and chats of each harness, defaults, names taken and cut),
   the constraints, the routes, the harness rules on agents and chats, turn resolution; no frontend tests.
   **Gateways for Codex, and the profile's gateway decides: done 2026-11-10** (docs/subscriptions.md "Gateways",
   docs/harness.md "Credentials and gateways"; Ihor: "Codex runs without a gateway… it should run through the gateway as
   well… push the profile to the session/folder the agent starts in on the end machine"). A gateway has a provider,
   `anthropic` (Claude Code) or `openai` (Codex), in its account details (`accountMeta.provider`; older gateways read as
   `anthropic`, no data step); `POST /api/me/subscriptions {kind: 'gateway', provider?, baseUrl, headers}`. Migration
   `0016_gateway_provider` drops the CHECK that kept gateways on Claude profiles: an OpenAI profile takes one too, and a
   profile takes only a gateway of its provider (422 `gateway_provider_mismatch`, replacing `gateway_not_allowed`). The
   Codex driver gives the gateway as a custom model provider in config overrides (`model_provider="mwc_gateway"`, its
   `name`, `base_url`, `wire_api="responses"`, `requires_openai_auth=true` for a login or `env_key="CODEX_API_KEY"` for a
   key in `codex exec`, the headers as `env_http_headers` naming `MWC_GATEWAY_SECRET_HEADER_<n>` variables), and
   `model_provider="openai"` without one; each key checked against Codex 0.162.1's own config loading (`codex mcp list`
   with a scratch `CODEX_HOME`). The Claude Code driver gives every turn and terminal a private settings file
   (`--settings <path>`, 0600 in the runner's folder for the harness and the agent's folder, removed with the process's
   other private files): the gateway's `ANTHROPIC_BASE_URL` and `ANTHROPIC_CUSTOM_HEADERS`, or Anthropic's own address
   and no headers, so a machine's `~/.claude/settings.json` gateway no longer captures a turn (flag settings rank above
   user, project and local settings in Claude Code 2.1.322's own source order). `PrivateFile.option` (the runner names
   the file on the command line) and an optional `PrivateDir.env` in `@mwc/harness-core`. Web: the gateway form asks
   "For Claude Code" or "For Codex" first, with the addresses to try; gateway cards show it; every profile card has a
   Gateway slot listing only its provider's gateways. Tests: the migration's constraint change, the provider rules, the
   routes, both drivers' arguments, environment and settings, the runner writing, naming and removing the settings file
   in turns and terminals; no real turn run, no frontend tests.
   **Universal gateways: done 2026-11-10** (docs/subscriptions.md "Gateways", docs/harness.md "Credentials and gateways";
   Ihor: "The gateway is a universal thing… I'm using 1 gateway for both… I do not need to select it on the gateways
   page"). A gateway is a name, an address and headers, with optional per-CLI paths in its account details
   (`accountMeta.paths: { claude?, codexChatgpt?, codexApiKey? }`, defaults `""`, `/backend-api/codex`, `/v1`); the
   gateway provider of earlier that day is gone (`accountMeta.provider` neither read nor written, old values ignored).
   `@mwc/shared/credentials`: `gatewayRouteOf(harness, kind)`, `gatewayPathsOf`, `joinGatewayPath` (no double or
   trailing slash, an address already ending with the path kept) and `gatewayAddressOf`; the credentials module builds
   each turn's `HarnessGateway.baseUrl` with them (Claude Code: the address + `claude`; Codex with `codex_oauth`: +
   `codexChatgpt`; with `openai_api_key`: + `codexApiKey`), the drivers unchanged. Any profile takes any gateway (422
   `gateway_provider_mismatch` removed, nothing replaces it; no migration, nothing in the database enforced a match).
   `POST /api/me/subscriptions` takes `paths`; `PATCH /:id` also changes a gateway's `baseUrl` and `paths` (422
   `not_a_gateway` for another kind). Web: the gateway form asks the name, the address and headers, with an "Advanced:
   paths" fold; gateway cards show the derived addresses; every profile's gateway slot lists all gateways. Tests: the
   derived-address rule, gateway add and update with and without paths, any profile taking any gateway, the turn spec's
   gateway address for Claude and Codex chats (ChatGPT and API key) through one gateway; no frontend tests.
   **Gateway header previews and editing: done 2026-11-13** (docs/subscriptions.md "Gateways"; Ihor: "I do not see
   HEADERS... can I edit??"). Each gateway's view has `headers: [{ name, preview }]` (`agk-NTE5••••MHx8`; a scheme word
   kept), made when the headers are sealed and stored in `credentials.header_previews` (migration
   `0034_gateway_header_previews`, no data step: a gateway sealed before it gets its previews on its first list, one
   `preview` use). `PATCH /:id` takes `headers`, the list the gateway keeps (`{ name, from?, value? }`: kept, renamed,
   new value, added; left out removed), sealed again, audited by names only (422 `header_not_found`,
   `header_value_required`). Web: cards list `name: preview`; **Edit** changes the address, headers and paths in place.
   Tests: the preview rules, stored and made-later previews, edit semantics, refusals, the audit without values, no
   value in any response; no frontend tests.
   **Machine tools: done 2026-11-10** (docs/machines.md "Tools", docs/runner-protocol.md "Tools"; Ihor: "Can we have
   some link, and some automation/verification in the MACHINES management?", then the versions and "if it requires
   update"). The runner reports `caps.tools` (Claude Code, Codex, git, gh, Docker: each found one's `--version`, asked
   once at start; `caps.harnesses` kept for older servers) and sends `runner.caps` when they change, which the hub takes
   at once (a CLI installed later needs no reconnect); new frames `tools.check`, `tools.install {tool, version}`,
   `tools.output`, `tools.result`. `POST …/machines/{machineId}/tools/check`, `POST …/tools/install {tool}` (202; the
   runner's `npm install -g --prefix ~/.local` of `@anthropic-ai/claude-code@2.1.308` or `@openai/codex@0.163.0`, the
   Dockerfiles' pins, with the npm beside its Node, one at a time, 10 minutes, never in a container, audited) and `GET
   …/tools/install/{installId}?from=` (its output and end); `GET machines` gains `runner.tools` and `runner.toolsLatest`.
   Web: the card's Tools part (versions, "update available", Check again, Install / Update with its output), the folded
   card's line, `/:slug/machines?machine=<id>#tools`, the chat header's harness CLI chip and the agent form's warning
   under Access profile, both linking there. No migration. Tests: the frames, the runner's search, npm process (fake
   spawn: its exact arguments, output and caps, success, failure, busy, timeout, container, npm missing) and wire, the
   hub's `runner.caps` and `tools.output`, the routes (roles, offline, outdated, busy, container, audit); no real install,
   no frontend tests.
   **Model and effort live in the access profile: done 2026-11-10** (docs/subscriptions.md "Model and effort"; Ihor: the
   model "should be part of the PROFILE as well… NOT agent config for sure", "list of models is needed for sure!!…
   reasoning could be different from Claude as well"). `@mwc/shared/models`: the catalogue, Claude's Claude 5 family
   (Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.1; 1M; low to max) and the models Codex 0.162.1 shows a ChatGPT sign-in,
   read from the presets compiled into its binary without running a turn (GPT-6.1 Sol, GPT-6 Astra, GPT-6 Sol, GPT-6
   Luna, GPT-5.6 Sol, Terra and Luna, GPT-5.5; 272k; each with its own levels of low, medium, high, xhigh, max and
   ultra); `Effort` is the union, `PROVIDER_EFFORTS` each provider's, `contextWindowOf` reads the catalogue first and
   `profileWindowOf` sizes a profile on the provider's default. Migration `0017_profile_model`:
   `access_profiles.model` and `effort` (null: the provider's default); its `-- custom:` data step gives each profile
   its agents' most used model and most used effort (a tie: the newest agent's; `codex-default` and a model of the
   other provider become null; unused profiles stay null), audited by the system; then `agents.model` and
   `agents.effort` go (`agents.harness` stays). Routes: profiles take `model` and `effort` (422
   `model_provider_mismatch`, `effort_unsupported`; a malformed id 400); agents no longer take or return them and show
   `runsWith: {model, effort, provider} | null` on their views and the chart; turns and terminals run the effective
   profile's model and effort (`turnModel`'s marker rules kept, `turnEffort`), and a chat's detail sizes its window by
   its profile when the events do not. `mwc agents list`, `mwc org tree` and the MCP's `agents_list` and `org_chart`
   show the profile's model and effort (`default`, `no profile`); `seedProfile` in `@mwc/testkit`. Web: the profile card
   and New profile get Model (the provider's list, "<Provider>'s default", another id) and Effort (its levels, with a
   hint); the agent form drops Model and Effort and says "Runs <model> at <effort>" under the profile; cards, the table,
   the header and the chart show the profile's; the context meter is sized by the profile's model. Tests: the
   catalogue, the backfill seeded at `0016` (several agents per profile, ties, a cross-provider model, `codex-default`,
   unused profiles, the dropped columns), the profile routes per provider, `runsWith`, turns on the chat's or the
   agent's profile, the CLI and MCP output; no real turn run, no frontend tests.
   **Machine software against npm's latest: done 2026-11-10** (docs/machines.md "Tools", docs/harness.md): `runner.toolsLatest` is npm's latest Claude Code and Codex (6 h cache, the pins as fallback, `source`, `checkedAt`), Update installs it, and turns and terminals turn the CLIs' own update checks off (`-c check_for_update_on_startup=false`, `DISABLE_AUTOUPDATER=1`); tested with a fake registry.
   **Codex context readings and plan costs: done 2026-11-10** (docs/harness.md "Codex", "Context and cost"): a Codex turn's `turn.completed` usage also gives a `context` marked `estimate` (the meter shows "≈"; Codex 0.167.0's exec stream has no last request's usage, window or model), the meter names the profile's model or "Codex's default", and a turn on a login or setup token keeps `includedInPlan` in its usage, so its cost reads "included in your plan"; no migration, no frontend tests.
   **Branch a conversation: done 2026-11-10** (docs/harness.md "Branching"; Ihor: "I would love to have a BRANCH conversation button"). `POST …/chats/{chatId}/branch {turnId}` (admins and owners) begins a new chat with the same agent that continues from a reply, titled "<parent> (branch)", with the parent's harness, machine, profile choice and the reply's session; refusals `turn_not_found`, `turn_running`, `turn_not_branchable`, `branch_unsupported` (none today), `branch_latest_only`, `agent_archived`. Its first turn resumes the session forked (`TurnSpec.forkSession`): Claude Code `--resume <id> --fork-session`, from an earlier reply also `--resume-session-at <uuid>` (a hidden print-mode option found in Claude Code 2.1.322's binary), the uuid the main agent's last message's, which the parser now keeps as the result's `messageId`; Codex `codex exec fork <thread>` (0.167.0), which forks a whole thread, so the latest reply only. The `session` event clears `fork_pending` (not when it names the parent's own session); the terminal waits for it (`branch_pending`); a runner without `caps.forks` refuses the turn (`runner_outdated`). Migration `0018_chat_branch`: `chats.branched_from_chat_id`, `branched_from_turn_id` (composite keys, `ON DELETE SET NULL (column)` in its `-- custom:` part) and `fork_pending`. Web: Branch beside Copy under agent replies (disabled with the reason where only the latest can branch), the branch opens with "Branched from <parent> · <time>", a branch icon in the chat list. Tests: the migration's keys and checks, the route (roles, running turn, finished replies, latest-only for Codex, an old reply, a compaction, a Clear, the copied fields), the first turn's spec and the session clearing `fork_pending`, the terminal and Clear before it, an old runner, the drivers' fork arguments and the parser's message uuid; no real turn run, no frontend tests.
2. Run folder, detached spawn, journal, re-attach, stop ladder — runner integration with the fake `claude`.
3. Server: tables, state machine, scheduler, reaper, `run_inputs`, `task_sessions`, SSE, `agent_placements` — API integration.
4. UI thread + run status + `mwc task create|send|tail|stop` — Playwright smoke sends a message and sees the reply.
5. **Structure review** (`.claude/skills/keep-structure/references/review.md`): `pnpm mwc structure --report` and the open lessons, then at most 5 improvements, each with its evidence, to Ihor before the tag; each one he approves lands as its own commit.

**Processes (2026-11-11, Ihor):** tasks run through a team's **flow**: steps of the kinds Work, Check and Sign-off, each with a person or an agent assigned, Keep or Fresh when the same task comes back, a send-back target and a limit per step that hands the task to the team's Lead. The team's manager is that Lead and orchestrator, not a step. The design is `docs/processes.md`; it reshapes the rest of S5 as S5.3a (flows and tasks, moved by hand), S5.3b (steps run, artifacts), S5.4 (runs survive restarts), then S6 (agents' tools and the Inbox), and a check with his DEVBOX team end to end. The review flows planned for S7 move here. An animated "assembly line" view of the steps comes last, once all of that is approved.

**S5.3a, flows and tasks, server side: built 2026-11-11 on the `flows-server` branch, not merged yet** (docs/processes.md "Built in S5.3a"). Migration `0022_flows`: `flows` (one per Lead), `flow_steps` (position, kind, assignee, starts, on return, send-back target and limit; steps keep their ids when the list is reordered), `tasks` (`T-<n>` per company, state, step, step state, rounds per step, escalation, priority) and `task_events` (the history, with the steps' names as they were), and four task notification kinds. The `tasks` module (the map's `tasks/`): pure rules for the step list, the moves (`start`, `hand_on`, `pass`, `approve`, `send_back` with its limit escalating to the Lead, and the Lead's `route`, `retry`, `cancel`) and who may make them (the step's person, the Lead's people: the Lead when a person and every person above it, admins and owners); flows (list, by id, by Lead, create, rename, `PUT …/steps`, the written form, the board), tasks (list with filters and pages, create queued or into a step, read with history and the caller's moves, edit) and `POST …/tasks/{taskId}/actions`; notices to the person a task comes to, the Lead's nearest person on an escalation, and the creator and that person when done. `flowText` in `@mwc/shared/flows`, `peopleAtOrAbove` in `@mwc/shared/org-chart`. CLI: `mwc task create|list|show|move`, `mwc flow show`. Tests: every rule (each move, the limit, the retry, the step list, who may act), the routes on PGlite (each role, other companies' 404s, the board, the history, the notices, a step removed with and without tasks), the CLI against the test server, the db constraints and keys. No web yet.

**S5.3a, the web: built 2026-11-11 on the `flows-web` branch, not merged yet** (docs/processes.md "Web"). The rail's
Flows item; `/:slug/flows` (every team's flow as a card with its steps' chips and counts, "Create a flow" for a manager
without one); a team's page `/:slug/flows/<lead>` with its Board (Queued, each step with its kind's colour and
assignee, Done, Escalated; the Lead's people drag a card onto a step to route it, a refusal puts it back with the
server's words; New task; read again every 30 s) and its Flow (the drawing with its dashed send-back arrows, the written
form with Copy, and the editor in place: name, kind, assignee, Starts, Comes back again, Sends back to, limit, reorder by
handle or Up and Down, remove, `step_has_tasks` shown); the task page `/:slug/tasks/T-12` (the notifications' links:
its moves from `actions`, Send back with its required reason, Route to a step, Cancel asked first, the drawing with its
step ringed and its rounds, the description in Markdown, the facts and the history); "Open its flow" / "Create its
flow" in the org chart's card menus; the gallery's `/design/flows` on sample data. No server change; no frontend tests
(typechecked, built in `--full`).

**S5.3b, steps run: built 2026-11-11 on the `steps-run` branch, not merged yet** (docs/processes.md "Built in S5.3b",
docs/harness.md "Task turns", docs/runner-protocol.md "Artifacts"). Server and runner; the web's views of the
conversations and the artifacts are the next step. Migration `0023_task_runs`: a task's conversation at a step is a chat
(`chats.task_id`, `task_step_id`, `task_round`; out of the agent's chat list, opened from the task), `tasks.blocked_reason`,
`task_artifacts` (task, step and its name, round, name, kind `file|note|link|skipped`, type, size, SHA-256, bytes up to
2 MB, the conversation and turn, the agent), the history kinds `blocked` and `turn_ended`, the notices `task_turn_ended`
and `task_blocked`. Entering an agent's step that starts by itself (or Start) starts its turn as the person who moved the
task, in the step's conversation: Keep goes on in the same chat (resumed, with only the hand-off since its last round),
Fresh begins one per round, different steps never share one; a start the chats refuse blocks the task with their words.
The prompt is `stepPrompt` of `@mwc/shared/flows` (the task, the flow's written form with "you are at", what the step's
kind asks and how to answer, the hand-off with the reason, findings and round of a send-back, the last reply and the
artifacts, the outputs folder; within 20 000 characters). Every message turn of a task conversation reports to the
tasks module through the chats module's `TaskTurnHook` (`app.ts` wires one chats runtime for both): its start (a
person's reply works on the task again), each collected file, and its end (`ended_without_handoff`, or `blocked` on a
failure, told to the Lead's nearest person; the reply kept as the round's hand-off note). A move while the step's turn
runs is refused (`step_running`) unless `force`, which stops it. The runner makes `tasks/<key>/artifacts/<n>-<step>/round-<n>/`
under the agent's home before the turn and collects what is new or changed after it (20 files, 2 MB each, 10 MB, text and
images; the rest listed as skipped) over the new optional frames `turn.artifact` (128 KB parts) and `turn.artifacts`; the
hub puts files together and checks them. `GET …/tasks/{taskId}/artifacts` and `…/{artifactId}/content` (viewers and
up); the task's detail lists its conversations, the board's cards count artifacts. CLI: `mwc task show` lists both,
`mwc task artifact <key> <name> [--step] [--round] [--out]`, `mwc task move … --force`. Tests on PGlite with `FakeRunner`
(auto and manual entry, Keep and Fresh, blocks, ends, failures, replies, forced moves, the files and their limits, an old
runner, the API's roles and other companies' 404s), the runner's collection on a temporary folder and a sized fake, the
prompt per kind and round, the CLI. Merging needs the dev API restarted (its migration runs on start) and the runner
bundle rebuilt, then Update runner on each machine (an old runner still runs steps, without collecting files).

**S5.3b web: built 2026-11-11 on the `steps-web` branch, not merged yet** (docs/processes.md "Built in S5.3b", "Web").
The task page lists its conversations as chips (step, rounds, agent, Running/Ended/Failed, last activity) with the open
one's live thread inline (the chat views' thread, the composer whose reply sets the task working again, Stop, "Open as
chat", "Open in Claude Code"; the current step's latest first), its artifacts by step and round (hand-off notes
highlighted, image thumbnails and full size, a Markdown/text viewer, skipped files with why, Download through the bearer
client), "Blocked at …" with its reason, the turn-ended line, and "Stop the turn and move" (confirmed, `force: true`) on
a `step_running` refusal. Board cards: the artifacts count and a pulsing Working; a blocked pill's reason as its tooltip.
Server: `lastTurn` on the detail's conversations, `blockedReason` on board cards (tested). The agent page's task
conversations wait for an API. Gallery samples for all of it; no frontend tests (typechecked).

**S5.4, runs survive restarts: built 2026-11-11 on the `runs-survive` branch, not merged yet** (docs/harness.md
"Surviving restarts", docs/runner-protocol.md "Chat turns", docs/machines.md "One job at a time", docs/processes.md
"Across restarts"). Item 2 above (run folder, detached spawn, journal, re-attach, stop ladder), for chat and task turns.
Runner: each turn runs through a keeper (`node runner.mjs keep`, its own session and process group, the one extra
process per turn) in `<state>/runs/<12 hex>/` (meta without secrets, the stdout journal and stderr as files, the numbered
events log, the messages written, `exit.json`, the keeper's socket); the runner reads the journal every 100 ms, logs each
event before sending it, and holds frames back while detached; a restarted runner takes its turns back (the keeper's
socket proves the process is the turn's; dead without `exit.json` ends `process_lost`), re-parses the journal up to its
log, names them in `runner.hello.turns` and resends what `turn.resume` says the server lacks; the keeper holds stdin, so
Now deliveries work after a take-back; the question socket listens again for the same token; the private folder is
adopted (a rewritten Codex login still goes back); the outputs folder is collected at the end. The ladder is SIGINT,
SIGTERM 10 s, SIGKILL 20 s, only while the keeper is there. Stopping and self-updating leave turns running; updates no
longer wait for turns; the systemd unit says `KillMode=process` (an old unit is fixed at start). Server: a dropped link of
a runner with `caps.reattach` leaves its turns `running` and detached for `MWC_TURN_GRACE_SECONDS` (180 s), a hello
re-binds them (`turn.resume` with the last stored event, dedup by `(turn, seq)`), a restarted server builds a turn's sink
from the database when its runner says hello with it and ends the left ones after the grace (`server_restarted`); Stop
while detached goes on re-attach (or the turn ends `stopped`); the queue starts nothing meanwhile; the task is blocked
only when a turn finally fails; `turn.ack` follows a recorded end; the detail and stream say `detached` ("Reconnecting…"
on the web). No migration. Tests: the keeper in-process, the runner on the fake keeper, real-process tests with the real
keeper and the fake harness (take-back mid-turn, the end while away with and without `exit.json`, the full ladder, pid
reuse, Claude input mode, and a chaos test that SIGKILLs a runner process mid-turn), and the server on PGlite with
`FakeRunner` (detached and resumed, a hello leaving a turn out, Stop while detached, the queue, a restarted server, the
grace failing a task's turn once, the left-turn sweep). Merging needs the dev API restarted (no migration) and the runner
bundle rebuilt, then Update runner on each machine; that first update runs under the old runner, which ends its live turns
as it restarts (or refuses with `busy`), and only the new runner keeps them.

### S6 — inbox, attention, CEO chat tooling  ← **the SLOP BOX milestone**

Done when the demo below passes on the Mac and then on the devbox:
1. MCP shim + runner tool server (`ask_user`, `permission`, `report_blocked`, `submit_for_review`, `post_message`, `read_task`), per-run `mcp.json` — tests: shim ↔ socket, schemas, fake `claude` calling tools.
2. `attention_items` service: routing, CAS resolve, expiry, both wait modes, answer → tool result or next turn — integration per kind.
3. Inbox UI + `mwc inbox list|answer|watch|count` + `@mwc/mcp` tools (`send_message`, `read_thread`, `task_status`, `inbox_list`, `inbox_answer`); a Claude Code status-line recipe for `mwc inbox count`.
4. **Demo:** SLOP BOX placed on the Mac first (home folder with its CLAUDE.md and skills, its own `CLAUDE_CONFIG_DIR`, policy `bypass`, worktree root), then on the devbox (`mwc runner install` once over the existing IAP SSH, `systemd --user` + linger). Ihor's Claude Code sends a message through `@mwc/mcp`; SLOP BOX works, calls `ask_user`; the item appears in the inbox and in `mwc inbox watch`; he answers with `mwc inbox answer`; the run continues (live if within 90 s, otherwise as a resumed turn) and reports done; a `report_blocked` variant lands in the inbox as blocked. Recorded against the real CLI; replayed in Playwright with the fake `claude`.
5. **Structure review** (`.claude/skills/keep-structure/references/review.md`): `pnpm mwc structure --report` and the open lessons, then at most 5 improvements, each with its evidence, to Ihor before the tag; each one he approves lands as its own commit.
   **S5/S6 review: built 2026-11-12 on the `review-s6` branch, not merged yet** (one review for S5 and S6, before
   `v0.6.0`; pure refactors, public import paths unchanged). (1) The runner hub's turn board split: its contracts in
   `hub/turn-types.ts`, taking turns back in `hub/turn-resume.ts`, the hub's interfaces in `hub/types.ts` (`hub/turns.ts`
   291 → 167 lines, `hub.ts` 289 → 167). (2) The files at 99%: the runner daemon's parts made in `daemon/runner/parts.ts`
   and its caps by `capsOf` (`daemon.ts` 298 → 235), the runner's `turns.test.ts` split along its describes (468 → 196),
   the config's modes in `shared/src/config/modes.ts` (`config.ts` 297 → 261). (3) The web's image caches share one
   versioned store, `api/images/store.ts` (`api/` 26 → 23 entries). (4) The sockets test pings on a fake clock, so a
   loaded machine cannot cut its sockets. The report went from 118 warnings to 113. Items 3 and 4 of the review, built
   after S6c on the `review-s6b` branch, not merged yet: (5) one check for the agents' tool inputs, `checkToolInput` and
   `issueLines` in `shared/src/flows/tool-input.ts`, run by the server's `tasks/service/tools.ts` and the runner's
   `turns/ask/` (three copies of the issue words gone; the question tool keeps its heading), and the tools' words in
   `flows/tool-words.ts` (`flows/tools.ts` 275 → 188 lines); (6) the principals' names read in one place, the org
   module's `principalNames` (`org/service/names.ts`, its reads in `org/repo/names.ts`), for the tasks, the inbox and the
   notifications (three `namesOf` with their own `Someone` and three copies of their reads gone; `inbox/service/names.ts`
   removed). With S6c merged the report went from 114 warnings to 113.

**S6a, agents move tasks themselves: built 2026-11-11 on the `task-tools` branch, not merged yet** (docs/processes.md
"Built in S6a", docs/harness.md "Agents' tools", docs/runner-protocol.md "Chat turns"). Through the runner's MCP bridge
(item 1's tool server, on the S5.2 socket and token), a task step's turn gets `task_read`, its kind's moves
(`task_hand_on`; `task_pass`, `task_send_back`; `task_approve`, `task_send_back`), `task_attach` (a note, a link, or a file
of its outputs folder, kept now) and `task_blocked`; a flow Lead's own chats get `team_board`, `task_show`, `task_create`,
`task_route`, `task_start`, `task_retry`, `task_cancel`, which act at once as the Lead agent. A step's move is recorded
as the turn's decision (`tasks.decision`, migration `0024_task_decisions`; a second call replaces it; past the step's
limit it says the task will be escalated) and applied when the turn ends done, as the agent, in place of
`ended_without_handoff`, its summary, findings or note the round's hand-off note; a failed or stopped turn drops it.
New optional frames `turn.tool` → `turn.tool.result` (a relay; the server re-checks the turn, the step's assignee, the
task's step, the kind, the move and, for the Lead, its own flow), `caps.agentTools`, `TurnSpec.tools`,
`TurnArtifact.callId`. `rules/access.ts` knows agent callers (a Lead agent in its flow, a step's agent on its step
through its decision). The step's prompt names the tools when the runner offers them (the S5.3b text otherwise), and a
Lead's chats get a short section naming its tools. Claude Code's `--allowedTools` lists every offered tool (one
comma-joined argument); Codex gets `MWC_TOOLS` among the MCP server's `env_vars`. Web: the recorded decision on the task
page ("Developer will hand on to Code review"), actors' faces in the history, "reported by" on an agent's block. Also
fixed: the step prompt named the first step as the next one (a row compared by identity). Tests with the fake runner and
fake harness only. Merging needs the dev API restarted (the migration runs on start), the runner bundle rebuilt and
Update runner on each machine (an old runner keeps the S5.3b behaviour: no tools, a person moves the task).

**S6b, the Inbox: built 2026-11-11 on the `inbox` branch, not merged yet** (docs/processes.md "Built in S6b",
docs/notifications.md "Web"). What needs a person is computed live from the tasks and the chats (no table): a Sign-off or
another step of theirs, an escalated task and a blocked one or one whose turn ended without a hand-off in a team they lead
(the Lead's people on the chart), and an agent's open question for admins and owners; viewers get none. `GET
/api/companies/{companyId}/inbox` and `GET /api/me/inbox` (across the caller's companies; an API key covers its own),
each with `/count`; every item names its company, task or chat, who moved it, since when and the moves the tasks API
allows the caller, the most urgent first. The web's right rail becomes the Inbox: two tabs, Attention (compact cards;
Approve and Send back… in place for a Sign-off, Open for the rest; every 30 s and after a move) and Notifications (moved
from the top bar's bell, which is gone: Mark all read, Show older, Email me these); the collapsed strip shows the
attention count on the inbox icon (red) and the unread on the bell (blue); quick create picks a team by its Lead's chip
and a title (queued, or into the first step for those who lead the team), replacing the "Tasks arrive in S4" dock; the
left rail's muted Inbox item is gone. `mwc inbox list|count [--all]`, `mwc inbox approve|send-back`. Not built: the live
wait (`attention_items`, answers reaching a waiting process, `mwc inbox watch|answer`, the MCP's inbox tools). Merging
needs the dev API restarted (new routes; no migration) and the web reloaded.

**S6c, the Lead wakes up by itself, and Inbox answers: built 2026-11-12 on the `lead-wake` branch, not merged yet**
(docs/processes.md "Built: the Lead wakes up" and "Inbox answers", docs/notifications.md, docs/harness.md "Delivery while a
turn runs"). When a flow's Lead is an agent, a task escalated, blocked, a turn ended without a hand-off (on by default),
done (a digest) and a sign-off waiting past N hours (off by default) are written as `lead_wake_events` in the transaction
that made them (migration `0025_lead_wakes`, also the flows' eight `wake_*` settings, `chats.flow_id` and
`chat_turns.system`); a tick in the app's process (every 5 s with MWC_JOBS) tells a flow's events once its quiet window
(60 s) passed, as one short message (`leadWakeMessage` of `@mwc/shared/flows`: the task, the step, the reason, the decision
with its tools) queued "after this turn" by Most Wanted in the flow's team chat with its Lead (made on first use, "<flow>:
team"; a waiting wake-up takes in the next). Events a person handled meanwhile are let go; past the caps (6 an hour, 40 a
day) or when the Lead cannot run (no placement, no runner, no profile, paused) the Lead's nearest person is told once
(`lead_not_woken`). `GET|PUT …/flows/{flowId}/lead-wakes` (the Lead's people and admins change them); the Flow tab's "Lead
wakes up on"; the board's "Lead notified"; Most Wanted's turns marked in the chat. Agents' questions: the inbox item carries
them, the card answers in place through the chat's answers route, and admins and owners get `agent_question`. Tests with
the fake runner only. Merging needs the dev API restarted (the migration runs on start) and the web reloaded; the runner is
unchanged.

**Direct reports' chats in the right rail: built 2026-11-12 on the `rail-chats` branch, not merged yet** (docs/harness.md
"Your direct reports in the rail"). Ihor's ask: his chats with his direct reports (the PM first) as shortcuts in the right
rail. `GET /api/companies/{companyId}/me/report-chats` (member and above, read only, no migration) lists the agents that
report to the viewer, the Leads first, each with its main chat with the viewer (the latest they began with it, neither a
task's conversation nor a team chat), whether a turn runs, an open question, its latest reply and the viewer's latest
message, and a Lead's team chat. The collapsed strip shows their icons under the inbox and the bell with a state dot
(question amber, working green pulsing, unseen reply blue; seen marks per browser), at most six with "+N"; the rail gets a
third tab, Chats: the open agent's chat, compact (the chat page's thread and composer, `dense`), a switcher among the
reports, With you / Team chat for a Lead, New chat and Open full chat; the first message begins a chat when there is none.
The same tab works in the narrow drawer. Merging needs the dev API restarted (a new route) and the web reloaded.

**A stopped machine starts for a message or work: built 2026-11-12 on the `machine-wake` branch, not merged yet**
(docs/machines.md "A failed start at the keep-on hours" and "Waking a machine for work", docs/harness.md "When the
machine is stopped"). Ihor's devbox stayed off one morning (This Mac slept through the keep-on start, which then failed
and was never tried again), and his messages to its agents were refused. The scheduler sends a failed keep-on start again
every 5 minutes while the hours last. The machines' wake starts a devbox (or a container with this server's Docker) for
a message (`autoStartOnMessage`) or work (`autoStartOnWork`, a task's step and a Lead's wake-up), or when an admin asks
(Start and send), logged with its reason; the turn waits `queued` (`chat_turns.machine_wait_at`, migration
`0026_chat_machine_waits`) and starts when the machine's runner connects, or fails in words (the start failed, 10
minutes passed); Stop ends it. Switch off: `machine_stopped` with the machine (the web's Start and send), a step blocked
in words. The chat shows "Starting Airia devbox… 0:42" until it runs; the Machines page's two switches lose "from S5".
Merging needs the dev API restarted (migration 0026 runs on start) and the web reloaded; the runner is unchanged.

**Turns survive a network outage, and the devbox's tunnel comes back fast: built 2026-11-12 on the `durable-link`
branch, not merged yet** (docs/harness.md "Surviving restarts", docs/machines.md "The standing tunnel",
docs/runner-protocol.md "Chat turns"). A blip of This Mac's network at 18:10 kept the devbox's tunnel down for 8 minutes
(every retry hit the box's stale port holder, cleared only once in 5 minutes, while the backoff grew to 160 s), the
180 s grace failed the Lead's chat turn and QA's step turn ("The machine disconnected during the turn.", T-2 blocked)
although the runner kept both alive, and the runner's hello at 18:19 got `lastSeq: null`, so it stopped them. Turns: the
grace is 30 minutes for every machine (`MWC_TURN_GRACE_SECONDS`, now up to 86 400; one default rather than per kind,
since a runner that comes back without a turn ends it at once and Stop now ends a detached turn at once); a turn that
does fail says `machine_disconnected: Airia devbox was unreachable for 30 minutes: the turn stopped.` (or came back
without the turn, or a runner too old to keep it), and a blocked task shows those words; a hello naming a turn the
server failed because its runner was away (`machine_disconnected`, `server_restarted`) takes it back while nothing else
started in its chat, and a task blocked only by that failure and unmoved carries on at its step (`started`, "The machine
came back with the turn; it goes on"); else the runner hears `lastSeq: null` as before. The chat's pill reads
"Reconnecting to Airia devbox… 2:14" (`detachedAt` on the turn), a task's conversation "Reconnecting". Tunnel: the spec
says whether the box reads running (`TunnelSpec.running`); a tunnel that was up clears the box's port before its next
try; while the box reads running the port is cleared before every try after a forward failure (at most once in 20 s)
and the backoff stops at 30 s; a waiting tunnel starts at once when its box turns running; ssh gets `ConnectTimeout=30`
(not `TCPKeepAlive`: ssh talks to gcloud's IAP helper over a pipe). No migration; the runner's code is unchanged (its
bundle carries the tunnel rules for a runner that holds tunnels once rebuilt; This Mac's server holds them in
development). Merging needs the dev API restarted and the web reloaded.

**The Lead checks in and never waits; a turn waits for a free slot: built 2026-11-12 on the `lead-checkins` branch, not
merged yet** (docs/processes.md "Check-ins", docs/harness.md "Waiting for a free slot"). On T-2 the DEVBOX Lead polled
`task_show` inside its turn for 10 minutes, edited the Developer's results itself, and its two turns filled the devbox's 2
slots, so the Developer's turn was refused `busy` and the task blocked with the reason "busy". Ihor: "why don't we have
BACKGROUND check things by PM? each 3-5 min etc?". The Lead's standing section and every wake-up now say: never wait or
poll inside a turn, end it, Most Wanted wakes you (events and check-ins); never edit a step's files or artifacts. A flow
checks in with its agent Lead every N minutes while it has active or escalated tasks (`flows.wake_check_in_minutes`,
migration `0027_lead_check_ins`: off, 3, 5, 10, 15 or 30, default 5, existing flows too): a digest of the open tasks (step,
state, how long, whether a turn is on it; the stuck first) in its team chat, skipped while the Lead has a turn or the
flow's events wait, and when nothing changed and nothing is stuck; never starting a stopped machine; counted in the caps,
whose defaults rose to 12 an hour and 150 a day (flows still at 6 and 40 moved, audited). A turn whose machine has every
slot taken waits `queued` (`chat_turns.machine_wait = 'slots'`, migration `0028_chat_slot_waits`) and starts when a turn
there ends, the chat waiting longest first; a runner's `busy` puts it back to waiting; it fails after 30 minutes in words;
the task stays `working` ("Waiting for a free slot on Airia devbox"); a turn taken back late (durable-link) counts as
running for the slots. A step's failure is stored in words naming the
machine (a bare code read back in words). "Check in every" on the Flow tab. Merging needs the dev API restarted
(migrations 0027 and 0028 run on start) and the web reloaded; the runner is unchanged.

### Between S6 and S7: the team room (Ihor, 2026-11-12)

"Why in the team chat, others are not contributing … So there is a real teamchat. imagine that i'm here and Added
collegue. So we are 2 humans 5 agents." He chose:

1. **Faces on every message** (built first, branch `chat-faces`). An agent's icon, a person's avatar, or Most Wanted's
   mark for system notices.
2. **A flow's team chat becomes a group room.**
   - **Who's in it:** the Lead, every step agent, and people.
   - **Who may write:** the team's people on the org chart (the Lead's manager and anyone placed in the team) and
     company admins and owners. Other members read only.
   - **Step ends:** each step agent posts one line when its step ends (handed on, passed, sent back, blocked), under
     its face, made from its own summary of that move. This costs no tokens and wakes no one; the Lead keeps its
     event wake-ups and check-ins.
   - **A person's message reaches every agent of the team**, his choice: "everyone may chime in". Each agent gets a
     turn in its own room conversation (Keep context) with the recent messages, answers in the room under its face,
     or stays silent: an empty or "nothing to add" reply posts nothing.
   - **Guards:**
     - an "@Name" message goes only to those agents;
     - agents' own posts never trigger other agents, so there are no loops;
     - the turns wait for free machine slots;
     - a per-room cap on answers an hour.
   - **Built 2026-11-12** (branch `team-room`; docs/processes.md "The team room"; waiting for his live test):
     - `room_messages` per flow (a person's message, a step-end line, an agent's reply, Most Wanted's notice), each agent's
       room conversation its chat of the flow, `chat_turns.room_message_id` and `flows.room_max_per_hour`, migration
       `0031_team_room` (the team chats so far copied into their rooms, step prompts marked Most Wanted's).
     - Step-end lines on every applied decision and a turn ended without a move; wake-ups and check-ins as notices with
       the Lead's replies; a person's message asking every agent (or the "@" named), silence (`NOTHING_TO_ADD`) posting
       nothing, the cap (30 an hour by default, all or nobody), message-trigger machine rules, no loops.
     - Writers: the Lead's people, those under the Lead and the steps' people (member and up), admins and owners.
     - Web: the rail's Team chat and the team page's Team chat tab with faces, step-end rows, @ completion, a read-only
       line; the room's cap on the Flow tab.
     - The faces work's two oddities fixed: a person's words never go into a wake-up's turn; step prompts are Most
       Wanted's.

### Between S6 and S7: a missing home folder is made (Ihor, 2026-11-13)

TEST DEV, hired on the Docker runner with the home folder `/work/test-dev`, failed its first message with `home_missing`
("Does it mean it should be created?!"). **Built 2026-11-13** (branch `make-folder`): the runner frame `fs.mkdirp`
(`caps.mkdirp`; a folder and its parents only inside `/work` in a container, else the runner user's home, the nearest
existing folder's real path checked, 0755, `created`), `POST machines/:machineId/folders` with `parents` (201 made and
audited, 200 there, 409 `runner_outdated` for an older runner); a container runner makes a turn's missing home under
`/work` before it starts; elsewhere the chat's `home_missing` offers Create folder, then Send again, and the agent form
says "Not on the machine yet" with Create. Runners need the rebuild and update (a Docker runner: Update container).

### Between S6 and S7: a chat outlives a lost conversation (Ihor, 2026-11-13)

After **Update container** on the Docker runner, his next message in an existing chat failed with "No conversation found
with session ID": the rebuild kept `/work`, the state and the CLIs' volumes, but Claude Code's store lived in the
container's own layer. **Built 2026-11-13** (branch `session-survive`): the image sets `CLAUDE_CONFIG_DIR` and
`CODEX_HOME` to the new volumes `runner-claude` and `runner-codex`, and a turn keeps the machine's own
`CLAUDE_CONFIG_DIR` (docs/machines.md "The Docker runner's volumes"); Codex's turns already kept their threads under the
state volume. On any machine, a turn whose resumed conversation the harness no longer has ends `session_missing` (the
runner reads the CLI's own words), and the server starts it again once, after the end's ack, on a fresh conversation
whose prompt recaps the chat's last 20 exchanges, with a notice in the thread and the new session stored; task steps'
conversations too (docs/harness.md "A lost conversation"). Runners need the rebuild and update; the Docker runner needs
Update container for the volumes, and that first rebuild still starts with an empty Claude Code store.

### Between S6 and S7: a decision log the agents write (Ihor, 2026-11-14)

"When Agent is taking some decisions, i could have some traceability WHY he has done something" (for a company review
agent first); he chose a decision log the agent writes. **Built 2026-11-14** (branch `decision-log`; docs/processes.md
"Decisions"): the agents' tool `record_decision {what, why, sources?, outcome?}` with one standing line, in every message
turn of every agent whose runner says `caps.decisions`; the per-company `decisions` table (migration `0038_decisions`,
audited as the agent, `contact_id` without a foreign key until the contacts land); `GET …/decisions` by agent, chat,
task, contact and outcome (members and above); a card in the chat where each was made, a Decisions panel on the
agent's page and a tab on the task's. The full trace beside it: a tool row opens to the call's whole input and the
result's whole text (`tool.input`, `tool_result.output`). Runners need the rebuild and update (the tool's name and
`caps.decisions`, the whole inputs and results).

### S7 — real work: tool sign-ins, worktrees, pull requests, Jira (one ticket each, behind the same tests discipline)

Reshaped on 2026-11-12 with Ihor ("GitHub LOGIN and Confluence Login. I do wanna have SIMILAR profile to push data as
we are doing with the Profiles for OpenAI and Claude. MAKE it as a next step of the plan!!! Important!!"). Done before
it, outside the stage plan: review flows (S5.3, S6), agent chats per agent (S5.1), the devbox's power schedule (S4).
Each item names the v1 behaviour it replaces and ships with integration tests.

1. **S7.1 Tool sign-ins and the profile's tool parts: GitHub and Atlassian (Jira and Confluence)**, first, Ihor's priority. The
   same shape as the AI subscriptions and profiles (S3, docs/subscriptions.md):
   - **Sign-ins in the personal store** (Subscriptions page, a Tools part):
     - **Sign in with GitHub:** GitHub CLI's own device sign-in (`gh auth login --web`) in the sign-in helper's
       throwaway sandbox, as v1 did, with no app to register. A pasted fine-grained token is the alternative. Kinds
       `github_oauth` and `github_token`.
     - **Add Atlassian:** the site (`<name>.atlassian.net`), the account email and an Atlassian API token, which serve
       both Jira and Confluence (`atlassian_api_token`). An Atlassian OAuth 2.0 (3LO) app is the later upgrade, once
       there is a public address for its callback.
     - Each sign-in is encrypted like the AI logins, write-only, managed only in a Clerk session, and audited. The
       card shows the account it acts as, its scopes or sites, and a check that it still works.
   - **Tool parts of a generic profile** (separate tool profiles until 2026-11-13, when Ihor asked for "a SINGLE
     profile ... with sub accesses to the tooling", then for generic profiles whose parts are Claude, OpenAI, GitHub and
     Atlassian):
     - **A GitHub part:** one GitHub sign-in, the repositories it may touch (all, or a list), and what it may do:
       read, push branches, open pull requests. It never merges, deletes, force-pushes, or pushes to the default
       branch.
     - **An Atlassian part:** one Atlassian sign-in, Jira read, Jira changes (comment, transition, create), and
       Confluence read or write, in chosen spaces. It never deletes or archives.
     - An agent gets them with its one profile, as before only from the profile's owner in companies they administer.
       The agent's page and its briefing say what it may do there and as whom.
   - **How a turn uses them:** the secrets stay on the server where they can.
     - **Atlassian:** server-side tools in the agents' `mwc` tools: `jira_search`, `jira_issue`, `jira_comment`,
       `jira_transition`, `jira_create`, `confluence_search`, `confluence_page`, `confluence_create_page` and
       `confluence_update_page`. The server checks the profile's rights on each call and shows every write in the turn
       and the task's log. The token never reaches the machine.
     - **GitHub:** git and `gh` need it on the machine. The runner gets it for one turn only: `GH_TOKEN` in that
       turn's process, plus a git credential helper that asks the runner, so it is never written to disk. It is
       refused for any repository outside the profile.
   - Tests: the kinds and their checks with fake providers, the profiles' rules, each tool's permission check, the
     runner's per-turn handover with a fake `gh`. Ihor's first real sign-ins are the live check.
   - **Decided with Ihor (2026-11-12):**
     - Atlassian signs in with an API token for now.
     - GitHub and Atlassian get separate tool profiles, picked per agent next to the AI profile (reshaped 2026-11-13:
       they are parts of one generic profile).
     - Work stops after each step below for a live test.
   - **How his Mac does it today**, read on 2026-11-12, as the model to follow:
     - git pushes over SSH with the Mac's key (`git@github.com:AiriaLLC/...`);
     - `gh` is signed in through GitHub's device sign-in, with the token in the keychain, for PRs, runs and repos;
     - Atlassian goes through Atlassian's remote MCP (`mcp.atlassian.com`, OAuth), whose tool names are
       `getJiraIssue`, `searchJiraIssuesUsingJql`, `getConfluencePage`, `createConfluencePage`, and so on.
     - So a GitHub turn gets `GH_TOKEN` and git's own `gh auth git-credential` helper, with `git@github.com:` rewritten
       to https, all through the turn's environment (`GIT_CONFIG_*`), with nothing written to disk. Existing SSH
       remotes then push with the profile's token.
     - The Atlassian tools keep the remote MCP's names and inputs, so agents' habits and skills carry over.
   - **Steps**, each ending in a stop for Ihor's live test:
     - **S7.1a** The sign-ins: Sign in with GitHub (device sign-in), a pasted GitHub token, and Add Atlassian (site,
       email, API token). Each is checked against the provider, showing the account, the scopes and whether Jira and
       Confluence answer, on the Subscriptions page's Tools part. Test: he signs in to both, and the cards show his
       accounts.
       **Built 2026-11-12** (docs/subscriptions.md, "Tool sign-ins"; waiting for his live test):
       - Kinds `github_oauth`, `github_token` and `atlassian_api_token` in the personal store (sealed, write-only,
         session-only, audited), and migration `0029_tool_sign_ins`: the kind CHECK, `checked_at` and `check_error`.
       - Sign in with GitHub: `gh auth login --hostname github.com --git-protocol https --web --scopes workflow
         --insecure-storage` in the sign-in helper's sandbox with no terminal, then `gh auth token` and
         `gh api user --include` in it (the port's new `run`). `deploy/Dockerfile.login` carries gh 2.103.3,
         checksum-pinned.
       - `POST /api/me/subscriptions/tools`: a pasted GitHub token, or an Atlassian site, email and token, checked
         with GitHub `GET /user` or Jira `myself` and Confluence `user/current` before it is stored (or renewed in
         place with `credentialId`).
       - Check again (`POST /api/me/subscriptions/:id/check`) and a daily check in the jobs loop. A 401 means
         `needs_sign_in`; each check is a `tool_check` use.
       - Limits leave tool sign-ins out. The page's Tools part: the cards and Add a tool.
       - Tests with a fake provider and a fake helper for every kind, the checks, the 401 path, the job, write-only
         secrets, the owner and session rules and the audit.
     - **S7.1b** The tool profiles: GitHub and Atlassian profiles on Access profiles, with their rights; the agent
       form's two pickers; and the agent's page and briefing. Test: he gives his DEVBOX agents profiles.
       **Reshaped 2026-11-13: one profile with tool parts, at Ihor's request**, then made generic the same day ("I
       wanted to have PROFILES not Claude Profiles... i.e. GENERIC profile"; docs/subscriptions.md, "Profiles" and "Tool
       parts"; the note below is what was built first, on 2026-11-12):
       - A profile is a name and optional parts: Claude and OpenAI (subscription, gateway, model, effort), GitHub and
         Atlassian (a sign-in and the S7.1b rights); Slack later. No provider on the profile; one profile with both AI
         parts serves a Claude Code and a Codex agent. Agents keep one `profile_id` and need the part their harness runs
         on (422 `profile_part_missing`, also on a harness change); removing an AI part agents run on is refused, naming
         them. The two membership defaults stay, each pointing at a profile with that part.
       - Migration `0032_generic_profiles`: each part's typed columns on `access_profiles`; every profile gets the part
         its provider was and nothing is deleted (Ihor's two tool-only profiles stay, with just their tool part); an
         agent's tool profiles are copied into its profile when unambiguous, else it refuses naming why; the provider,
         its columns, `rights` and `agents.github_profile_id` / `atlassian_profile_id` go.
       - `/api/me/access-profiles` adds, changes and removes parts under `parts`; agents and the chart show the profile's
         parts (never a subscription or its account); runs, chats and the briefing read the harness's part and the tool
         parts.
       - Web: the Profiles page (the rail and links renamed), one flat list of cards with a section per part and Add
         buttons for the missing ones, New profile by name only, no filler; the agent form's Harness choice and one
         picker listing each profile's parts, misfits disabled, with the parts line under it.
       - Tests: the parts' rules and routes, giving and harness changes, defaults, the agent's and chart's view, turns
         and chats on the harness's part, the briefing, the migration's parts, copies and each refusal.
       **One AI part, 2026-11-13** (Ihor: "we have to LOCK in Profile, that we can Choose EITHER 1 harness EITHER 2nd
       one... NOT BOTH simultaneously! this should simplify this selector as well!"; docs/subscriptions.md, "Profiles"):
       - A profile holds Claude or OpenAI, never both: migration `0033_one_ai_part` adds the CHECK (it refuses, naming
         the profile, if one has both), the server a second AI part with 422 `one_ai_part`. Tool-only profiles stay;
         they are given to no agent (422 `profile_no_ai_part`).
       - An agent's harness follows its profile's AI part, set by the server on hire and update (`harness` left the
         agent routes; the column stays, derived); taking the profile off keeps it; chats on the old harness say
         `harness_changed` as before. A hire without a profile takes the hirer's Claude default, else the OpenAI one.
       - Web: no Harness control; the Profile picker lists "name · Claude", tool-only ones disabled ("No AI part"), one
         parts line under it; the Profiles page offers Add Claude and Add OpenAI only while a profile has neither.
       **Mode in the profile, and the chat's own mode, model and effort, 2026-11-13** (Ihor: "I would love to set it in
       the PROFILE, with an ability to change in the CHAT"; docs/subscriptions.md "Mode", docs/harness.md "Modes"):
       - Each AI part has a mode: Claude Code's Manual, Accept edits, Plan, Auto, Skip prompts (its `--permission-mode`
         values), Codex's Ask, Auto, Full trust (its sandbox and approvals); Manual and Ask by default. The agent's
         Permissions setting (`agent_placements.permission_policy`) is gone: migration `0035_profile_mode` gives each
         profile Skip prompts or Full trust when all its running, placed agents had `bypass`, else Manual or Ask (a
         notice names the profiles whose agents differed), and drops the column.
       - A message chat may run its next turns in its own mode, model and effort (`chats.mode`, `model`, `effort`;
         `PATCH …/chats/:chatId/overrides`), even while a turn runs; task steps, Lead wake-ups and team room turns run
         on the profile's; a provider switch clears them. Each turn records what it ran with. The turn spec carries
         `permissionMode` beside the old `permissionPolicy`, so runners need updating for the new modes (an older one
         runs Manual or Ask as `ask`, Skip prompts and Full trust as `bypass`).
       - Web: Mode on the Profiles page's AI part; the composer's Mode and Model menus (the full chat and the docked
         one, short labels, opening upward); a turn's footer names its mode, model and effort; no Permissions on the
         agent form or the Hire page.
       - Tests: the modes and `chatRuns` (shared), the migration (agree, differ, unused), the drivers' flags per mode,
         the spec builder (override, profile, task turns), the overrides route and its refusals, the provider switch,
         and the placement API ignoring an old client's `permissionPolicy`.
       **Built 2026-11-12** (docs/subscriptions.md, "Tool profiles"; waiting for his live test):
       - Profile providers `github` and `atlassian` (`ProfileProvider`; `AiProvider` keeps Claude and OpenAI for models,
         defaults and harnesses), each holding one sign-in of its tool and its rights, with no gateway, model or effort.
         Migration `0030_tool_profiles`: `access_profiles.rights` and its CHECKs, the widened provider CHECK, and
         `agents.github_profile_id` and `atlassian_profile_id` (`on delete set null`). No data step.
       - The rights in `@mwc/shared/credentials` (`credentials/tool-rights.ts`): GitHub `repos` (all, or `owner/name` and
         `owner/*`), `push`, `pullRequests`, read always; Atlassian `jira` off/read/changes in `jiraProjects`,
         `confluence` off/read/write in `confluenceSpaces`. Never a merge, delete, force-push, default-branch push or
         archive. Safe defaults; damaged stored rights count as none.
       - `/api/me/access-profiles` makes and changes tool profiles (rights as a whole set, audited); the agent routes carry
         `githubProfileId` and `atlassianProfileId` by the AI profile's giving rules, with no default, and show
         `githubProfile` and `atlassianProfile` (account, site, rights, never a secret); removal and leaving take them off
         with their audit rows. The briefing ends with one line per tool profile (`credentials/tool-words.ts`).
       - Web: GitHub and Atlassian groups and forms on Access profiles (`ToolRightsFields`, `ChipsInput`), the agent
         form's two pickers, the agent's facts and the Hire page's briefing preview.
       - Tests: the rights and words in `@mwc/shared`, the migration's CHECKs and keys, the profile and parts rules, the
         tool profiles' routes, the agents' giving, view, audit, removal and leaving, and the briefing route.
     - **S7.1c** The Atlassian tools for agents: Jira read first, then Confluence read and write, then Jira changes,
       each checked on the server against the profile. Test: an agent reads a real ticket and writes a Confluence
       page in a test space.
       **Built 2026-11-13** (docs/subscriptions.md, "Atlassian tools"; docs/harness.md, "Server tools"; waiting for his
       live test), all four at once, with the remote MCP's names in place of the `jira_*` ones planned above:
       - The tools: `searchJiraIssuesUsingJql`, `getJiraIssue`, `getTransitionsForJiraIssue`, `getVisibleJiraProjects`,
         `lookupJiraAccountId` (Jira read); `addCommentToJiraIssue`, `transitionJiraIssue`, `createJiraIssue`,
         `editJiraIssue` (summary, description, labels; Jira changes); `searchConfluenceUsingCql`, `getConfluencePage`,
         `getConfluenceSpaces`, `getPagesInConfluenceSpace` (Confluence read); `createConfluencePage`,
         `updateConfluencePage` (Confluence write). Their inputs are the remote MCP's; `cloudId` is ignored. Nothing
         deletes or archives.
       - Server tools on the wire: `TurnSpec.serverTools` (whole definitions) to a runner that says `caps.serverTools`;
         the runner writes them to the turn's folder (`MWC_SERVER_TOOLS`) and its MCP server lists and relays them, so
         later server tools need no runner change. Claude Code's `--allowedTools` takes camelCase names. **The runner
         changed: it needs rebuilding and updating once.**
       - The port `@mwc/tools-core` (`AtlassianApi`, `AtlassianError`) and the connector `connectors/atlassian` (Jira v3,
         Confluence v2 and the v1 search, basic auth, an injected fetch, 429 retried after `Retry-After`, deadlines,
         ADF ⇄ Markdown), wired in `app.ts` through `platform/atlassian.ts`.
       - The integrations module (`modules/integrations/`): the offer by the turn's profile's Atlassian part, a line in
         the standing instructions, and every call checked again (rights, refused arguments, input, the project and space
         allowlists with JQL/CQL scoping), the sign-in opened for `tool:<name>` (`credentialsForTools`), changes audited
         as the agent, a 401 marking the sign-in `needs_sign_in`. The chats module's `ServerToolsHook` routes a call off
         the turn's write queue. The Atlassian briefing line names the tools.
       - Tests: the connector on a fake fetch (every endpoint, each refusal, 429, deadlines, ADF both ways), every tool
         through a live turn on a fake runner and the fake provider, the rights and allowlist paths, the JQL/CQL scoping,
         credential uses and audit, the offer per profile for Claude Code and Codex, the runner's listing and relay.
     - **S7.1d** GitHub in a turn: the per-turn token, the credential helper, the SSH rewrite and the repository
       allowlist. Test: an agent pushes a branch to a sandbox repo and lists its PRs.
       **Built 2026-11-13** (docs/subscriptions.md "GitHub tools", docs/harness.md "git in a turn"; waiting for his live
       test), after TEST DEV, asked about his pull requests, had no GitHub tool and no `gh`:
       - Server tools by the names and inputs of GitHub's MCP server as its README listed them that day (reads of one pull
         request or issue are one tool with a `method`, so `get_pull_request*` and `get_issue` are `pull_request_read` and
         `issue_read`): `search_pull_requests`, `list_pull_requests`, `pull_request_read` (get, get_diff, get_status,
         get_files, get_commits, get_review_comments, get_reviews, get_comments, get_check_runs), `search_issues`,
         `issue_read` (get, get_comments, get_sub_issues, get_labels), `list_commits`, `get_commit`, `get_file_contents`,
         `list_branches`, `search_repositories`; with `pullRequests` `create_pull_request`, `update_pull_request` (title,
         body, base, draft through GraphQL), `add_issue_comment` (pull requests only), `request_copilot_review`. Nothing
         merges, closes or deletes; `state`, `reviewers`, `maintainer_can_modify`, `comment_id` and `reaction` are refused by
         name. 14 tools, which fit beside Atlassian's 15 in a spec's 32.
       - Every call checked again: rights, input, the repositories allowlist (`owner/name`, `owner/*`, case ignored);
         searches get `repo:`/`user:` qualifiers when they name no scope, a scope outside is refused, and results outside
         are dropped. Uses `tool:<name>`, changes audited as the agent on `github_pull_request` `owner/repo#n`, a 401 marks
         the sign-in `needs_sign_in`.
       - The port `GitHubApi`/`GitHubError` in `@mwc/tools-core` and `connectors/github` (bearer, `X-GitHub-Api-Version`,
         redirects refused, rate limits retried after `Retry-After` or the reset when short, else refused with when),
         wired through `platform/github.ts`; the integrations module's one hook merges Atlassian's and GitHub's plans.
       - git and gh: with `push`, a runner that says `caps.github` gets `TurnSpec.github {token, repos}` (opened for
         `tool:git`); the runner puts it in the turn's environment only (`GH_TOKEN`; `GIT_CONFIG_*` with a credential
         helper reading `$GH_TOKEN`, `git@github.com:` and `ssh://git@github.com/` rewritten to https, `core.hooksPath`),
         never on disk. A read-only pre-push hook refuses the default branch, non-fast-forwards, deletions and repositories
         outside the allowlist, then runs the repository's own hooks; best effort (`--no-verify` skips it), GitHub's branch
         protection being the guarantee. Without push no token reaches the machine. The Docker runner's image carries gh
         2.103.3 (checksum-pinned as the sign-in image's); the Machines page's installs stay npm-only (Claude Code, Codex).
       - Tests: the connector on a fake fetch, every tool through a live turn on a fake runner and the fake provider, the
         rights, scoping, refusals, uses and audit; the offer and the git sign-in per case and harness; the runner's
         environment, nothing persisted, the hook with real git in temporary repositories, `caps.github`, the image's pin.
       - **The runner changed**: every runner needs rebuilding and updating once, and the Docker runner **Update container**
         (for gh too). Codex's push and gh are expected only in Full trust (its shell drops `*TOKEN*` variables by default
         and its sandboxes keep the network off): not verified.
     - **S7.1e Slack** (Ihor, 2026-11-12: "i wan to add SLACK TOOL as well.. I have a bot"):
       - **The sign-in:** his Slack bot's token (`xoxb-…`, kind `slack_bot_token`), checked with `auth.test`, which
         shows the workspace, the bot's name and its scopes.
       - **The rights:** a Slack profile holds read on or off, post on or off, and the channels it may use (`all`, or a
         list). DMs are off unless chosen, and it never posts `@here` or `@channel`.
       - **The tools:** server-side `slack_post` (into a channel or a thread), `slack_channel_history`,
         `slack_thread` and `slack_search` (if the token's scopes allow). The token never reaches the machine.
       - **Who it posts as:** posts show as his bot. With `chat:write.customize` each agent posts under its own name
         and icon, marked as an app.
       - A user token (`xoxp-…`), which would post as Ihor himself, is a later choice of his.
       - Test: an agent posts a short message in a test channel and reads the replies.
       **Built 2026-11-13** (Ihor: "lets do 7.1e... I have keys for slack… now! i need something where i can define
       scopes.. READ only etc"; docs/subscriptions.md "Slack", docs/harness.md "Server tools"; waiting for his live test):
       - The sign-in: one form for either token, the kind by its prefix (`slack_bot_token` `xoxb-`, `slack_user_token`
         `xoxp-`), checked with `auth.test` (the workspace, the bot or person, the bot's id) and the scopes from
         `X-OAuth-Scopes`, all kept; write-only, Check again, the daily check, `needs_sign_in` on `invalid_auth` and
         `token_revoked`, `tool_check` uses, as the other tool sign-ins. The card: the workspace, "Bot · <name>" or
         "User · <name>", the scopes as chips. A user token is allowed (it posts as Ihor: the part says "Posts as you").
       - The profile's Slack part (migration `0036_slack_part`: `slack_credential_id`, `slack_rights` through the parts
         map): `SlackRights` `read` (on), `post` (off), `channels` (`all`, or names and ids), `dms` (`off`/`read`/`post`),
         `search` (a user token's `search:read`), `react`, in `@mwc/shared`. The token's scopes cap them
         (`effectiveSlackRights`): no tool and a refusal naming the scope on the server, a disabled control with a
         tooltip on the Profiles page, 422 `slack_scope_missing` for a request turning one on. Never `@here`,
         `@channel`, `@everyone` (stripped), never deletes, edits others' messages, invites, kicks or administers.
       - The tools, by the reference Slack MCP server's names: `slack_list_channels`, `slack_get_channel_history`,
         `slack_get_thread_replies`, `slack_get_users`, `slack_get_user_profile`, `slack_post_message`,
         `slack_reply_to_thread`, `slack_add_reaction`, `slack_search_messages`, each checked on the server against the
         rights and scopes, the channel allowlist (names resolved to ids) and the DM rights. Posts on a bot with
         `chat:write.customize` show under the agent's name and emoji icon (as the bot without it); posts carry no footer
         (Ihor, 2026-11-13). Uses for `tool:<name>`; posts and reactions audited as the agent on `slack_message`. The port
         `SlackApi`/`SlackError` in `@mwc/tools-core` and `connectors/slack` (bearer, form arguments, `ratelimited` and
         429 retried after `Retry-After`, `not_in_channel` as "invite the bot to #x"), wired through `platform/slack.ts`.
       - The tool limit: GitHub's 14, Atlassian's 15 and Slack's 9 pass 32. A spec now carries up to 64
         (`SERVER_TOOLS_MAX`) to a runner that says `caps.serverToolsMax`; an older runner still gets 32, the least
         important left out first in a stated order (`DROP_FIRST`) and named in a last line, and the chat's notice says
         "all 38". **The runner changed** (it says `caps.serverToolsMax` 64): rebuild and update it once; until then
         turns keep working with 32.
       - Web: Subscriptions → Tools → Add a tool → Slack; the Slack card; Profiles → Add Slack with the sign-in, Channels
         (All channels or chips), Read, Post, Search, React and DMs Off/Read/Post. The briefing's Slack line.
       - Tests: the connector on a fake fetch, the check and its routes, the rights × scopes, the profile's refusals, every
         tool through a live turn (allowlist and name resolution, DMs, mention stripping, customize, rate
         limits, `invalid_auth`, uses and audit), the tool limit with old and new runners, the migration.
       - **Later** (Ihor, 2026-11-13): Slack may help mirror the team structure, a channel per team for example. Not
         built.
       - **Receiving messages, built 2026-11-13** (Ihor: "please enable it… we have to think how to natively link it… so
         we have an agent sitting and monitoring for things like that"; docs/subscriptions.md "Slack: receiving
         messages"; waiting for his live test): a Slack bot sign-in's app-level token (`xapp-`, sealed in
         `slack_connections`, migration `0037_slack_inbound`) keeps a **Socket Mode** connection (the connector acks
         every envelope at once, drops Slack's repeats, reconnects with a backoff and on Slack's refresh), in the server
         that runs the chats (MWC_JOBS). A DM to the bot, a mention, or a reply in an agent's thread from someone allowed
         (only the people listed by default, the owner's own Slack person first; or anyone in the profile's channels)
         wakes `@Bot @Agent`'s agent, the thread's agent (its recorded posts, `slack_posts`), or the default agent, in a
         chat of its own for that thread (`slack_threads`, Keep context, in its chat list), with 👀 first; its final
         reply is posted in the thread under its name unless it posted there itself, "Couldn't answer: …" on a failure.
         Guards: the agent's profile's channels and DM rights (outside ignored, without post said once), the hourly cap
         (30, said once), no bots or self, a stopped machine started only by its policy for a message; each wake an
         `inbound` use, audited. Web: the Slack card's Receive messages (the token, the switch and status, who can wake
         agents with a people picker, the default agent, the cap). The runner did not change.
       - **People search, 2026-11-13** (Ihor: typing "eri" found nothing; "when I start typing I need a progress bar"):
         the workspace's people kept in memory per bot sign-in (`service/slack/inbound/directory.ts`: every `users.list`
         page once in the background, `Retry-After` waited out, reloaded after 6 hours or on demand, one `slack_people`
         use per load), ranked by `rules/slack/inbound/people.ts`; the picker warms it on focus with a progress bar and
         lists matches as you type (keyboard, the typed part marked). The port's `SlackUser.email` and
         `SlackError.retryAfterMs` came with it.
       - **Live chat lists, built 2026-11-13** (Ihor: the Slack replies reached TEST DEV but his open chat page showed
         them only after a refresh; docs/harness.md "Live chat lists"; branch `live-chats`): the agent's chat list was
         read once and the rail every 15 seconds. Now `GET …/chat-activity` (members and above) streams each chat
         begun, renamed or archived and each turn that moves, whatever made it; the chat list puts a Slack
         conversation's chat on top at once with a dot, the rail reads again at once, and a Slack message's turn shows
         as its sender's, via Slack. A turn whose runner went away just before its start, and one taken back after the
         grace, are now told to the chat's stream.
       - **Contacts, built 2026-11-14** (Ihor: a colleague's DM showed as one Most Wanted bubble with the prompt's
         header; "if ERICH is requesting something i need to have it linked to ERICH. To his persona… and on the chart
         (next piece)"; he chose contacts made automatically; docs/subscriptions.md "Contacts"; branch `contacts`):
         migration `0039_contacts` (`contacts`, one per company, Slack workspace and person; a Slack message's turn
         stores its sender, visible text, contact and the reply's link; a Slack chat names the contact who started it).
         The first message of a person that wakes an agent makes their contact from `users.info`, and the next ones
         update it. The chat shows a Slack message as its sender's (their Slack photo and name linking to their contact,
         the Slack mark linking to the message, only their words), and a reply posted back says "Posted in Slack". The
         Contacts tab of Company structure and a contact's page (conversations, counts per agent, the note and archive;
         the decisions agents recorded in their conversations; `decisions.contact_id` is a key into `contacts` and
         `contactOf` answers the turn's or the Slack chat's contact). `GET …/contacts/interactions?since=` gives the org chart's
         Requesters column (the next piece) who talked to which agent in the last 7 days and who is being answered now,
         which the chats' activity also tells (`lastTurn.from.contactId`).
2. **S7.2 Per-task worktrees and branches:** each task gets its own git worktree and branch from a fresh origin
   default branch, under the agent's home folder (v1's `<home>/worktrees/<key>/`). It is kept across the task's steps
   and rounds, and cleaned up after Done.
3. **S7.3 Pull requests:** the coder pushes its branch and the flow goes on. After the last check the coder opens the
   PR with its GitHub profile, a Pull request step on the flow, as v1. A PR watch reads it read-only (checks, comments,
   conflicts) and hands findings back to the coder. A merge moves the task to Done.
4. **S7.4 Jira intake:** a flow's Jira sources (parents' children, labels, single tickets) read through an Atlassian
   profile, with live status. **Take** puts a ticket in Queued as a task linked to it. Optionally, a merged PR moves
   its ticket to Done in Jira.
5. **S7.5 Work in progress:** an in-progress limit per flow (v1 used 5) and auto-start from Queued under it (off by
   default).
6. **S7.6 Confluence as a place for results:** a step can publish its artifacts or a summary to a Confluence page in
   the profile's space, and the task links to it.
7. Sprints tied to releases (v1's Sprints page), and AI gateway routing per machine.

Last item: **Structure review** (`.claude/skills/keep-structure/references/review.md`): `pnpm mwc structure --report` and the open lessons, then at most 5 improvements, each with its evidence, to Ihor before the tag; each one he approves lands as its own commit.

### S8 — cloud deployment

Hardened compose for a VM (TLS via a reverse proxy, backups with `pg_dump` and restore drill, log rotation), then k8s manifests (migrate Job, server Deployment + Ingress, runner pool), secrets through the platform's secret store, a staging instance, runbooks, and the runner's signed self-update (moved from S4: download, verify sha256 + Ed25519, flip `current`, exit 75 when idle, drain). Email delivery over SMTP (S2.9 built the outbox only). Done when a staging stack on a cloud VM runs the S5 demo with a container runner and a laptop runner at the same time.

Last item: **Structure review** (`.claude/skills/keep-structure/references/review.md`): `pnpm mwc structure --report` and the open lessons, then at most 5 improvements, each with its evidence, to Ihor before the tag; each one he approves lands as its own commit.

## 19. Verification

- Per ticket: its unit/integration tests in `mwc check`; the stage's e2e smoke in `mwc check --full`; a short demo to Ihor at the end of each stage (he reviews stage by stage, as requested).
- S1 acceptance is a real second human accepting an invitation (never done in v1).
- S4 acceptance includes the chaos scripts (server kill mid-turn, runner `kill -9` mid-turn, 3-minute runner pause) with the fake `claude`.
- S5 acceptance is the SLOP BOX demo script in section 15 (Mac, then devbox), recorded with the real CLI and replayed in Playwright.
- S8 acceptance is the same demo on a cloud VM with one container runner and one laptop runner.

## 20. Execution model and first steps

- **Who executes (recommended):** the CEO office (this chat) writes `docs/architecture.md` and scaffolds S0 with Ihor watching, so the conventions (tenant layer, testkit, `mwc check`) exist before anyone else codes; from S1 the CORP product PM gets the stage tickets one at a time (as today), the Developer builds in worktrees with the port triplets, the PM closes deployed work; Ihor reviews each stage. The v2 epic parked in v1's task tracker is rewritten by the PM from this plan (folder `Most_Wanted_corp_v2`, ports 9950–9999, stages S0–S8) on Ihor's go. Alternative: the CEO office executes S0–S2 directly and hands over at S3. Either way, runs and task assignments start only on his request.
- **First commits:** S0.1–S0.7 above, then S1.2's real-Clerk contract test (the earliest external-dependency check), then S4.1's fake-`claude` fixtures recorded from the installed CLI (the earliest harness check).
- **Not touched:** v1 (both applications, their databases, the devbox, his sign-ins) stays as is; v1 keeps running the current teams while v2 grows on 9950–9999.
