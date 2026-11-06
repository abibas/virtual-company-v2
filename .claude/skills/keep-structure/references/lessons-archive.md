# Lessons archive

Settled lessons, moved out of [lessons.md](lessons.md) so agents do not read them before every change. Their outcomes are in SKILL.md's placement table, the module template and `packages/cli/src/structure/rules.ts`. Read an entry here only to learn why a rule is the way it is. Newest first.

### 2026-11-05: The subscriptions web: a 15th entry in components/, a 13th in forms/, and a page group held at 12

- **What happened:** S3.5 added the Subscriptions page, the add sheet with its sign-in and paste flows, access profiles
  and the home widget. Its page parts are one group, `components/subscriptions/` (12 files, the largest `PasteForm.tsx`
  at 238 lines and `sign-in.ts` at 226), so `components/` went from 14 to 15 entries. The library gained a meter, steps,
  a sheet, a secret field and an inline rename: `forms/` went from 12 to 13 entries with `InlineEdit.tsx` (a new
  `big-folder` warning). The first draft had three more warnings: `api/subscriptions.ts` imported by 8 files (`fan-in`),
  `ProfilesTab.tsx` at 254 lines (`near-limit`) and two functions over 60 lines (`ProfilesTab`, `useSignIn`).
  `forms/Segmented.tsx` went from 7 to 8 importers (the page's `Tabs`), a new `fan-in` warning.
- **Where:** `apps/web/src/components/subscriptions/`, `apps/web/src/api/subscriptions.ts`,
  `components/data/{Meter,Steps}.tsx`, `components/layout/Drawer.tsx` (`Sheet`), `components/forms/{Field,InlineEdit}.tsx`,
  `pages/SubscriptionsPage.tsx`, `pages/design/SubscriptionsMock.tsx`; the S3.5 commit.
- **What was done:** the meter and the steps went to `data/` (8 to 10 entries) rather than `ui/` (14); the sheet went
  into `Drawer.tsx` beside the drawer, sharing its focus hook, so `layout/` stays at 14; `SecretField` went into
  `Field.tsx` with the other labelled fields. The cards take callbacks (`rename`, `remove`, `update`, `create`) instead
  of the calls object, which left `api/subscriptions.ts` at 6 importers; the profile defaults stayed in `ProfilesTab.tsx`
  and the new-profile card moved into `ProfileCard.tsx` (200 and 222 lines), so the page group holds 12 files; the code
  form and the polling became hooks of their own (`useCode`, `usePoll`, `useDone`). The gallery mock reads the sample
  day from `records.ts`'s `days`, so `sample.ts` stays at 7 importers.
- **Suggested change:** the open web lessons again: let `components/` hold the library groups and the page groups apart,
  or raise `folderEntries` for `apps/web/src/components/` and its library groups; count only value imports for
  `fan-in` (a library primitive such as `Segmented.tsx` is meant to be imported by every page).
- **Status:** `adopted` (S3 structure review, 2026-11-06: fan-in leaves out the web library bc330a5; page parts in `features/` fc81548; library groups warn at 20 0f3be90).

### 2026-11-05: Provider usage checks in a module, not a connector

- **What happened:** S3.3's limits call three outside systems (Anthropic's usage API and Messages endpoint, OpenAI's
  `wham/usage`, and both providers' token endpoints). The placement table sends anything that talks to an outside
  system to a connector implementing a `packages/*-core` port. The step asked for all HTTP through an injectable
  `fetch` and no new packages, and the calls are small, read-only and owned by the credentials module's rules
  (which kinds have limits, the floors, re-sealing a refreshed token set). `service/secrets.ts` reached 244 lines with
  the store's two new changes (`near-limit`), the first `limitsService` was one 73-line factory of closures
  (`long-function`), the three checks' type imports took `schemas/limits.ts` and `schemas/secrets.ts` to 8 importers
  each (`fan-in`), and the fake provider needed a fixture beside the 12 in `apps/server/test/fixtures/`.
- **Where:** `apps/server/src/modules/credentials/service/usage/{http,claude,setup-token,codex,cache}.ts`,
  `service/limits.ts`, `service/secret-updates.ts`, `rules/limits.ts`, `schemas/limits.ts`;
  `apps/server/test/fixtures/credentials/providers.ts`; the S3.3 commit.
- **What was done:** the calls live in the module behind `ProviderFetch` (`AppDeps.providerFetch`, refused under
  NODE_ENV=test so no test reaches a provider), one file per provider, each tested against the fake. `secrets.ts` was
  split: the replacement and the status change went to `service/secret-updates.ts`, and the pure `credentialView`
  moved to `rules.ts` so the new file imports no value back from `secrets.ts` (secrets.ts 153 lines). The service's
  steps became module functions over one shared state object, and the checks take their vocabulary (the windows, the
  secrets they read) from `usage/http.ts`, which re-exports it (5 importers each). The fake provider
  went to a new folder, `test/fixtures/credentials/`, where S3.2's fake sign-in helper can go too (the fixtures folder
  is at 13 entries).
- **Suggested change:** a placement-table row: "A small read-only call to an outside system that one module owns, with
  no client package (a usage check) → that module's `service/<provider>.ts` behind an injected `fetch`; a connector
  when a second module or the runner needs it". When S5 relays runs to the providers, move these calls into a
  `connectors/ai-providers` package with a port in a core package.
- **Status:** `adopted` (S3 structure review, 2026-11-06: placement row 7c37c07; a connector once a second module or the runner needs it).

### 2026-11-05: A local process edge in the platform, a module's port importers trimmed, and the server's fixtures at 13

- **What happened:** S3.2's sign-in helper runs the official Claude Code and Codex CLIs' logins in a Docker container
  (development) or a temporary folder (a Linux server). The placement table sends "anything that talks to an outside
  system (Clerk, Claude Code, Jira)" to a connector behind a `packages/*-core` port; the helper talks to the local
  Docker daemon and to processes, not to a provider's API, and the step's brief put it in the server platform, so it
  went to a new platform folder next to `secrets/` and `jobs/`. Its port, `port.ts`, was first imported by 9 files of
  the server (`fan-in`): the two helpers, `process.ts`, `select.ts`, `env.ts` and four credentials files. The first
  draft of the session class was 244 lines (`near-limit`). The sign-in tests' doubles (a fake child process, a fake
  helper replaying CLI output, made-up CLI fixtures, the service world) took `apps/server/test/fixtures/` from 12
  entries to 13 (`big-folder`), even as one folder.
- **Where:** `apps/server/src/platform/login-helper/` (`port.ts` 55 lines, `process.ts` 135, `docker.ts` 158,
  `local.ts` 66, `tty.ts` 21, `select.ts` 36); `apps/server/src/modules/credentials/service/sign-in/` (`session.ts`,
  `context.ts`, `flows.ts`), `routes/sign-in.ts`; `apps/server/test/fixtures/sign-in/` (4 files); S3.2.
- **What was done:** the routes take the helper's type from the service's `SignInDeps` and the flows read files through a
  one-method interface of their own, so `port.ts` has 7 importers; the session's context and timers moved to
  `service/sign-in/context.ts` and two pure rules (`finishesOnExit`, `exitEnding`) to `rules/sign-in.ts`, so
  `session.ts` is 208 lines. The real `spawn` is injected everywhere (`select.ts` passes node's), so the Docker
  and local helpers are covered by tests with a fake child and nothing is excluded from coverage. The fixtures folder
  warning stays.
- **Suggested change:** a placement-table row: "Code that runs local processes or containers for the server (the
  sign-in helper; later the runner's own sandbox) → `apps/server/src/platform/<area>/` with `spawn` injected; a provider's
  API stays a connector". And let `apps/server/test/fixtures/` group helpers by module (`fixtures/<module>/`), as the
  acceptance scenario's folder does, or raise `big-folder` for `test/fixtures/` folders.
- **Status:** `adopted` (S3 structure review, 2026-11-06: placement row 7c37c07; `test/fixtures/` grouped by module 0f3be90).

### 2026-11-05: Access profiles: personal rows that company rows point at, read across both layers in one transaction

- **What happened:** S3.4's `access_profiles` is personal (an owner, no company), but `agents.profile_id` and
  `memberships.default_profile_id` point at it. The org module must read a profile's owner and name in a company's
  transaction (giving one, the agents' `profile` field, the leave hook), and the credentials module must write audit
  rows in each company when a profile is removed, in the owner's transaction. Neither `tenant()` nor `owned()` reaches
  the other's rows, a module may not use raw access, and a second connection inside a transaction hangs on PGlite (the
  S1.7 lesson). The placement table has no row for it. The two modules also need each other: the credentials module
  lists the agents using a profile and the org module reads the profiles.
- **Where:** `packages/db/src/owned.ts` (`ownedIn`, `ownersOf`, `OwnedDb.tenant`; 143 lines) with
  `tenant.ts`'s package-internal `tenantConnection` (239 lines); `apps/server/src/modules/org/repo/profiles.ts`,
  `service/profiles.ts` (typed on a structural `ProfileRepo`), `rules/agents.ts` (the give rule merged in, 156 lines);
  `apps/server/src/modules/credentials/{routes,service,repo,rules,schemas}/profiles.ts`; the S3.4 commit.
- **What was done:** bridges in `@mwc/db` instead of an exemption: `ownersOf` reads only whose a personal row is, and
  the row is then read through its owner's layer on the tenant's connection. One module direction only: the
  credentials module calls the org module's service (`agentsUsingProfiles`, `auditProfileRemoval`), the org module
  reads `access_profiles` through the bridges in its own repo and imports nothing of the credentials module. Two
  `fan-in` warnings were avoided: `org/repo.ts` stays at 7 importers (`service/profiles.ts` types its repo
  structurally) and `rules/placement.ts` at 7 (the give rule went into `rules/agents.ts`, not a new `rules/profiles.ts`);
  `identity/service.ts` went from 7 to 9 (`profilesOf` for the owners' names, `companiesOf` for the owner's companies),
  a new `fan-in` warning. The new response fields also needed the web's design samples and the hire preview to carry
  them (`profile: null`, `defaultProfileId: null`) for the web to typecheck, and the identity store's contract fixture
  to leave out `default_profile_id`.
- **Suggested change:** placement-table rows: "A personal row a company's rows point at → read in the company's module
  through `ownersOf` and `ownedIn`; the owner's module asks the company's module's service for its uses" and "A change
  of a person's own rows that writes company rows in the same transaction → `o.tenant(companyId)`". With the open
  `fan-in` lessons, count a module's files as one importer, which leaves `identity/service.ts` at 5 modules.
- **Status:** `adopted` (S3 structure review, 2026-11-06: placement row 7c37c07; a module counts once for fan-in bc330a5).

### 2026-11-05: Personal data: a third access layer, a third kind of route guard, and three folders at 13 entries

- **What happened:** S3.1's `credentials` and `credential_uses` belong to a person and to no company. The placement
  table knows two ways to the database: `tenant(db, companyId)` for tenant rows and raw access (`@mwc/db/system`) for
  the platform and the identity store; personal rows are neither, and a module may not use raw access. The routes
  are personal too (`/api/me/subscriptions`, a session only), which neither `companyRoute` nor `authn()` alone
  covers. The new files took three folders from 12 to 13 entries (`big-folder`): `packages/db/src/` (`owned.ts`),
  `packages/db/test/` (`owned.test.ts`) and `packages/db/src/schema/` (`credentials.ts`); the report went from 54
  warnings (without coverage) to 57 plus the low-coverage list. The server's master keyring is cross-cutting code
  with no business rules, so it went to a new platform folder.
- **Where:** `packages/db/src/owned.ts` (`owned(db, userId)`, `OwnedDb`, 99 lines) and `src/audit.ts` (`auditRows`,
  shared by both layers), `src/schema/credentials.ts`, `migrations/0007_credentials.sql`;
  `apps/server/src/platform/auth/personal.ts` (`requireSession`, `personalRoute`), `platform/secrets/{keyring,
  master-key}.ts`; `apps/server/src/modules/credentials/` with `schemas/secrets.ts` (the secrets' shapes, a role
  folder beside `schemas.ts`) and `service/secrets.ts` (the internal service); the S3.1 commit.
- **What was done:** a personal layer in `@mwc/db` beside the tenant layer (every statement scoped to
  `owner_user_id`, inserts stamped, audit rows with no company), so no new Biome exemption; `personalRoute` beside
  `companyRoute`; the three folders left at 13, since each file is its own concern and mirrors its source (merging
  `owned.ts` into `tenant.ts` would pass 300 lines). The test fixtures stayed at 12: `authWorld()` takes a `keyring`
  instead of a new fixture file.
- **Suggested change:** placement-table rows: "A person's own rows (no company) → a personal table with
  `owner_user_id`, reached through `owned(db, userId)`" and "A route under `/api/me/...` for the caller's own rows →
  `personalRoute(deps, { path, tag })`". At the next review, group the access layers (`packages/db/src/access/`
  with `tenant.ts` and `owned.ts`, re-exported as today) or raise `folderEntries` for `packages/db/src/schema/`, which
  grows by a table group each stage (S4 machines, S5 tasks and runs).
- **Status:** `adopted` (S3 structure review, 2026-11-06: placement rows 7c37c07; `schema/` warns at 20 0f3be90; `src/` back to 12 by moving the diagram, the access layers stay put (see the open entry)).

### 2026-11-05: User profiles: the session's fan-in, the cropper's round mask, and a changed column instead of a new one

- **What happened:** user profiles (Ihor's request) were specified as "migration `0006`: add `users.image_url`", but the
  column had been there since `0000_init`; what the feature needed was `users.display_name` nullable (a person without a
  name has none, so the web asks for it) and a data step clearing the email stand-ins stored before. In the web, the
  two new pages (`pages/OnboardingPage.tsx`, `pages/ProfilePage.tsx`) and `app/PlainShell.tsx`, which now draws the
  person's own menu, read the session, taking `app/session.tsx` from 7 importers to 10 (a new `fan-in` warning). The
  round crop mask and the cropper's buttons as `CropActions` keep `forms/image/ImageCropper.tsx` at 215 lines; the
  first draft's own split of the stage's input handling was dropped for the same split made on main in the meantime
  (`crop-gestures.ts`). The account menu and the profile form went to `components/auth/` (now 8 entries):
  `components/` is at 14 already, and a `profile/` group would have made it 15.
- **Where:** `packages/db/migrations/0006_user_profiles.sql` (its `-- custom:` part) and
  `packages/db/test/schema/users-backfill.test.ts`; `apps/web/src/components/auth/{AccountMenu.tsx,ProfileForm.tsx,
  profile.ts}`, `components/forms/image/{ImageCropper,LogoPicker,LogoZone}.tsx`; the user profiles commit.
- **What was done:** the migration changes the column the feature needs, and its data step is tested on a database
  seeded at `0005_org` (`migrateUpTo`), beside the table's test as the S2.1 lesson suggests. The profile form takes the
  session's `reconcile` as a prop, so no component of the library reads the session (as before); the pages and the
  plain shell do, and the fan-in stays: `app/session.tsx` is the web's platform, like `api/types.ts`, and passing the
  session down from `AppRoutes` would only hide the dependency. `/onboarding` and `/profile` are written as literals in
  `AppRoutes.tsx`, so the server's web test (the entry below) checks them against `RESERVED_SLUGS`.
- **Suggested change:** with the S1.11 lesson, leave `app/session.tsx` out of `fan-in` with the web's other platform
  files (or count only value imports), and a placement-table row for "pieces of the signed-in person's account (menu,
  profile form) → `components/auth/`".
- **Status:** `adopted` (S3 structure review, 2026-11-06: `app/` left out of fan-in bc330a5; placement row 7c37c07).

### 2026-11-05: A check on the web's routes, with no web tests to hold it

- **What happened:** company addresses moved from `/c/<slug>` to `/<slug>`, so every first path segment of the web
  and the server must be in `RESERVED_SLUGS` (`@mwc/shared/slugs`), and a test has to fail when a new route is not.
  `apps/web` may have no tests, and its route table is an if-chain in `app/AppRoutes.tsx` (plus `/design` in
  `app/App.tsx`), not data another package can import.
- **Where:** `apps/server/test/platform/http/web.test.ts` (the serving test of the built web, 127 lines) reads the two
  route files as text, leaves out their comments and checks the first segment of every quoted absolute path, and the
  first segment of every OpenAPI path. The web's one company link helper, `companyPath` in `app/nav.ts`, made that file
  a `fan-in` warning (10 importers; `router.tsx` has 29).
- **What was done:** the text check, so the parallel web work could keep the if-chain as it is.
- **Suggested change:** a placement-table row for checks that guard the web from outside it (the server's web test, as
  here), or a route table as data in `app/` that such a test imports; and `nav.ts` with the files meant to be imported
  everywhere in the open `fan-in` suggestions.
- **Status:** `adopted` (S3 structure review, 2026-11-06: placement row 7c37c07; `app/nav.ts` left out of fan-in bc330a5).

### 2026-11-05: The MCP server reuses the CLI's API client, company choice and rendering

- **What happened:** S2.6's `@mwc/mcp` needed more of the CLI than the saved logins: the GET with a personal key and
  the server's refusals, the chart and agents calls with their shapes, the key checked with `GET /api/me` and the
  company chosen, and the tree and table text, so its tools answer exactly what `mwc org tree` and `mwc agents list`
  print. The S1.9 lesson ("Code two packages run that is not a contract") foresaw this and suggested a small
  `packages/client`, which is not on the approved map.
- **Where:** `packages/cli/src/api/` (`client.ts` 71 lines, `org.ts` 127, `session.ts` 91) and `src/org/render.ts`
  (112), exported as `@mwc/cli/api/client`, `/api/org`, `/api/session` and `/org/render`; `account/api.ts`'s `getMe`
  now calls `apiGet`; `packages/mcp/src/tools/` imports them; S2.6.
- **What was done:** the code stays with its owner, the CLI, as subpath exports (the placement the S1.9 lesson
  suggests for runtime code another package reuses), so `@mwc/mcp` depends on `@mwc/cli` (which pulls in nothing but
  `@mwc/shared`). The clients' tests needed people on the chart and a key the real API accepts: `seedMember` and
  `seedApiKey` went to `@mwc/testkit`'s `src/seed.ts` (227 lines; a file of their own would have been the 13th entry
  of `src/`, a `big-folder` warning), since the server's own `seedApiKey` lives in its `test/fixtures/` and hashes with
  a server module the testkit cannot import (the testkit hashes the same way, and its test proves the server accepts
  the key).
- **Suggested change:** decide between keeping API clients as CLI subpath exports (a placement-table row: "an API
  client the CLI and the MCP server share → `packages/cli/src/api/`, exported") and a `packages/client` on the map
  before S4 adds the task and inbox calls to both.
- **Status:** `adopted` (S3 structure review, 2026-11-06: API clients stay CLI subpath exports, no `packages/client`; placement row 7c37c07).

### 2026-11-05: One module acting on another's state change, in its transaction: the org chart's lifecycle hooks

- **What happened:** S2.4 moves people on the org chart whenever a membership turns active or stops being active, in
  the same transaction. Every identity path (webhook events, a deleted user, the reconcile on sign-in, the self
  reconcile, Sync now, the periodic reconcile) changes a membership's status in one place, the database identity
  store's `upsertMembership` (`modules/identity/repo/memberships.ts`), the only call site that can hold that
  transaction (the reconciles run without one, a store call at a time); the members module's removal is the other.
  Calling the org module from there would add identity → org and members → org, while org already imports
  `identity/service.ts` (`profilesOf`, the chart's names) and identity and members already import each other (the S1.7
  entry below): new module cycles, and a repo calling another module's service. The placement table has no row for
  "module A acts when module B changes its state, in B's transaction".
- **Where:** `apps/server/src/modules/identity/repo/chart.ts` (69 lines: the port `MemberChart`, `ChartActor`,
  `ChartDeps`, `chartStep`, `lockedTenant`), `repo/memberships.ts` (120), `repo.ts` (208: `DbIdentityStoreOptions`
  gains `chart` and `requestId`), `modules/org/service/lifecycle.ts` (`memberChart`, and S2.3's `service/status.ts`
  merged in), `modules/members/service.ts` (`MembersDeps`), `service/remove.ts`, `apps/server/src/app.ts`
  (`withMemberChart`, `moduleJobs`); the S2.4 commit.
- **What was done:** the identity module defines the port (its `service.ts` re-exports it for the members module, which
  imports that file already); the org module implements it (`memberChart(deps)`, typed on its own); `app.ts`, which
  already composes the modules' jobs, passes it to the identity and members modules as `chart`, and the typecheck
  holds it to the port there. No module imports one it did not import before. The first draft imported the port's
  types from `identity/service.ts` in four more files (the org lifecycle, the members routes and removal), which took it
  to 11 importers, and its own `service/lifecycle.ts` took `org/repo.ts` and `org/rules/placement.ts` to 8: three new
  `fan-in` warnings. Now the members module types its deps as `MembersDeps` (its `service.ts`) and its removal's call
  structurally, and S2.3's
  `service/status.ts` (an agent archived or restored) went into `service/lifecycle.ts`, one file for every principal
  joining or leaving the chart: the three files keep 7 importers each. The cost: `SyncDeps`, `meService`,
  `identityRoutes`, `membersService`, `membersRoutes` and `DbIdentityStoreOptions` take `chart`, so the tests that build
  those deps by hand pass `testChart()` (`test/fixtures/org.ts`): 8 test files, a line or two each. The in-memory
  identity store and the store contract stay without a chart, so `packages/identity-core/src/memory-store.ts` stays at
  250 lines.
- **Suggested change:** a placement-table row: "Module A acting on a change module B makes, in B's transaction → a port
  B defines (in `repo/` or `service.ts`), implemented by A's service and passed in by `app.ts` (as `moduleJobs` and
  `withMemberChart` do); never an import that closes a module cycle." If more come (S4's tasks of a removed member, S5's
  inbox routing), consider one typed in-process list of membership events composed in `app.ts` instead of a port each.
- **Status:** `adopted` (S3 structure review, 2026-11-06: placement row 7c37c07).

### 2026-11-05: The org chart's web: a library group and a page group took components/ to 14 entries

- **What happened:** S2.5 added a library group, `components/org/` (the org tree, the node card, the manager select and
  their helpers: 5 files and a barrel), and the Agents pages' parts, `components/agents/` (12 files, the largest
  `AgentForm.tsx` at 228 lines). `components/` went from 12 to 14 entries (`big-folder`; a single new group would
  have made it 13, a warning all the same). The report without coverage went from 35 to 46 warnings: that one and
  10 `fan-in`, of which six are library primitives that the second large page area brought to 8 importers
  (`ui/Skeleton.tsx` 10, `data/format.ts` 9, `forms/ConfirmInline.tsx`, `forms/Input.tsx`, `ui/EmptyState.tsx`,
  `ui/IconButton.tsx` 8), three are the area's own shared files (`org/chart.ts` 11, `api/org.ts` 9,
  `agents/links.ts` 9, mostly type imports) and one is `api/client.ts` (8, the `Api` type only). One draft
  component went over 60 lines (`StatusActions`, 61) and was cut by a table of the next status. The card menus sit in
  a chart that scrolls sideways, which cuts off an absolutely placed dropdown: `Menu` got an opt-in `floating` panel
  fixed to the window (`forms/floating.ts`) rather than a new popover primitive.
- **Where:** `apps/web/src/components/{org,agents}/`, `apps/web/src/api/org.ts`, `components/forms/{Menu,floating}`;
  the S2.5 commit.
- **What was done:** the library pieces went to `org/` with a barrel, the page's parts to `agents/`, as the open lesson
  on the library describes them. `AgentList` went to `api/types.ts` with the other inferred shapes (so `api/org.ts`
  is imported for its hooks and calls), the members' `TableSkeleton` became `ui/Skeleton.tsx`'s `SkeletonRows` instead
  of a second page importing the members' panel, and the gallery's org sample reuses `records.ts`'s `days` instead of
  importing `sample.ts` (which stays at 7 importers).
- **Suggested change:** the two open web lessons again, now with this evidence: let `components/` hold the library
  groups and the page groups apart (`components/lib/<group>/` and `components/pages/<area>/`, or `folderEntries` raised
  for `apps/web/src/components/`), and count only value imports for `fan-in`, which would leave out `api/types.ts`,
  `api/client.ts` and most of `agents/links.ts`.
- **Status:** `adopted` (S3 structure review, 2026-11-06: fan-in bc330a5; page parts in `features/` fc81548).

### 2026-11-05: The org API: one routes file kept for fan-in, tests split by route group, rules parts that build on the entry

- **What happened:** S2.3 added six routes to `modules/org/`. Two route group files (`routes/agents.ts`,
  `routes/chart.ts`), as the module template suggests past about three routes, would each import
  `platform/auth/membership.ts` (`companyRoute`), taking it from 6 importers to 8 (a new `fan-in` warning). The
  module's new pure rules build on S2.2's (`validateMove`, `validateChart`), so `rules/placement.ts` imports the
  entry `rules.ts`, while `rules.ts` re-exports `rules/chart.ts` and `rules/violations.ts`: the folder holds parts the
  entry is made of and parts made of the entry. The slug rule companies and agents share (and the web copies) was a
  companies rule.
- **Where:** `apps/server/src/modules/org/routes.ts` (195 lines: two router functions, `agentRoutes` and
  `chartRoutes`, and one route factory per route), `rules/placement.ts` (159), `rules/agents.ts` (101); tests in
  `apps/server/test/modules/org/routes/{agents,agent-updates,positions,chart}.test.ts` (204 to 342 lines) with no
  `src/.../routes/*.ts` to mirror; `packages/shared/src/slugs.ts`; the S2.3 commit.
- **What was done:** one `routes.ts`, so `membership.ts` has 7 importers and the report keeps its count; the tests
  split along the route groups (one file would pass 1,100 lines). `rules.ts` does not re-export the new parts (that
  would make a cycle); the services import `rules/agents.ts` and `rules/placement.ts` directly. The slug rule went
  to `@mwc/shared/slugs` (a contract: two CHECKs, two modules and the web), with a fallback word per caller;
  `companies/rules.ts` re-exports it, so no import moved and its tests stayed as they were.
- **Suggested change:** the open suggestions of the S1.6 and S1.8 lessons (count a module's files as one importer for
  `fan-in`, and allow a test split along the seams of one source file) would have let the routes split by group
  without a warning. A line in the module template: "a rules part that builds on the entry's rules imports the
  entry and is not re-exported by it; the entry re-exports only the parts it is made of".
- **Status:** `adopted` (S3 structure review, 2026-11-06: a module counts once for fan-in bc330a5; route groups and test splits in the placement table, the rules-part line in the module template 7c37c07).

### 2026-11-05: The org tables: a table keyed by its principal, and a migration's data step with no source to mirror

- **What happened:** S2.1 added `agents` and `org_positions`. `org_positions` is one row per principal, so its primary
  key is `(company_id, principal_id)` and it has no `id`: like `company_logos` (the entry below), the skill's tenant
  rule ("`company_id` and `UNIQUE(company_id, id)`") and `packages/db/test/schema/tenant.test.ts` had no case for it.
  The migration's data step (every active membership placed on the chart) is a test with no source file to mirror;
  a `packages/db/test/migrations/` folder for it took `packages/db/test/` from 12 to 13 entries (`big-folder`). Two
  more assertions in `packages/db/test/diagram.test.ts` took it from 399 to 404 lines (`near-limit`). The new schema
  file took `packages/db/src/schema/columns.ts` from 8 to 9 importers (its `fan-in` warning was there already).
- **Where:** `packages/db/src/schema/org.ts`, `migrations/0005_org.sql` (its `-- custom:` part),
  `test/schema/tenant.test.ts` (`ONE_PER_PRINCIPAL`), `test/schema/org-backfill.test.ts`,
  `test/fixtures/migrations.ts`; the S2.1 commit.
- **What was done:** the tenant test lists `org_positions` apart and checks its own shape (the composite primary key,
  the principal a composite foreign key, no `id`). The backfill test went beside the table's own test,
  `test/schema/org-backfill.test.ts`, and `test/migrations/` was dropped, so `packages/db/test/` stays at 12. Its
  helper `migrateUpTo(handle, tag)` (a database left at an older migration) went to `test/fixtures/migrations.ts`, and
  `migrate.test.ts` uses it too instead of its own copy. The diagram test only had its counts updated (399 lines).
  The report is back to 39 warnings (1 near-limit, 5 long-function, 1 big-folder, 28 fan-in, 4 low-coverage).
- **Suggested change:** the skill's tenant rule, with the entry below: "...or, with one row per company or per
  parent, `company_id` or `(company_id, parent_id)` as its primary key and no `id`". A placement-table row: "A test of
  a migration's data step (`-- custom:`) → `packages/db/test/schema/<table>-backfill.test.ts`, seeded at the
  migration before with `migrateUpTo`". At the next review, split `packages/db/test/diagram.test.ts` (the renderer's
  own cases apart from the real schema's), which any new table brings closer to 400 lines.
- **Status:** `adopted` (S3 structure review, 2026-11-06: tenant rule and backfill row 7c37c07; `diagram.test.ts` split 0f3be90).

### 2026-11-05: A table with one row per company does not fit "UNIQUE(company_id, id)"

- **What happened:** company logos (Ihor's request, 2026-11-05) are one row per company, so `company_logos` has
  `company_id` as its primary key and no `id`. The skill's tenant rule ("every tenant table has `company_id` and
  `UNIQUE(company_id, id)`") and `packages/db/test/schema/tenant.test.ts`, which checks that pair on every table with
  a `company_id`, had no case for it. Its `company_id` also cascades on delete, unlike `companyIdColumn()`, so the
  helper of `src/schema/tenant.ts` did not fit either. The image (up to 1 MB) made `TenantDb.select` (every column)
  the wrong read for a company or a list, and the tenant layer had no way to name columns. The new schema file made
  `src/schema/columns.ts` (`createdAt`, `updatedAt`, `oneOf`, now `bytea`) a `fan-in` warning, 7 importers to 8 (the
  report went from 35 to 36 warnings after `pnpm mwc check`): every table file imports those helpers, so the next
  table would have done it. Two more `fan-in` warnings of the first draft were avoided: the logo service takes the
  acting principal's id instead of `MemberContext`, and the upload route types its body limit with `AppEnv`, so
  `platform/auth/actor.ts` stays at 6 importers.
- **Where:** `packages/db/src/schema/company-logos.ts` (45 lines), `test/schema/tenant.test.ts` (`ONE_PER_COMPANY`),
  `src/tenant.ts` (`selectFields`), `apps/server/src/modules/companies/repo/logo.ts` (a `repo/` file beside
  `repo.ts`, as the S1.7 lesson suggested for a second table).
- **What was done:** the table lists itself apart in the tenant test (its `company_id` is the primary key, points at
  `companies` and nothing points at it); `TenantDb.selectFields(table, fields, where?)` reads only the named columns,
  scoped like `select`; `docs/architecture.md` (section 6) and `packages/db/README.md` say so.
- **Suggested change:** the skill's tenant rule: "every tenant table has `company_id` and `UNIQUE(company_id, id)`,
  or, with one row per company, `company_id` as its primary key and no `id`". Leave `packages/db/src/schema/columns.ts`
  out of `fan-in` with the other files meant to be imported everywhere (the open S1.6 and S1.9 lessons), or count only
  value imports.
- **Status:** `adopted` (S3 structure review, 2026-11-06: tenant rule 7c37c07; type imports skipped for fan-in bc330a5, `schema/columns.ts` stays a warning (10 value importers)).

### 2026-11-05: Two library groups passed 12 entries with the company logo

- **What happened:** the create-company redesign added `ui/CompanyLogo.tsx` (a company's face, imported by 8 files at
  once: the rail badge, the switcher, the hero, the preview, the picker, the Settings panel and the gallery) and three
  files to `forms/` (`ImageDrop.tsx`, `LogoPicker.tsx`, `logo-file.ts`). `components/ui/` went from 12 to 13 entries
  and `components/forms/` from 10 to 13, so both are `big-folder` warnings; `CompanyLogo.tsx` is a `fan-in` one. Two
  more layout files (`CompanyBadge.tsx`, `UserWell.tsx`) would have taken `components/layout/` to 14; they went into
  `Rail.tsx` (the rail's badge) and `TopBar.tsx` (beside `UserChip`) instead.
- **Where:** `apps/web/src/components/{ui,forms,layout}/`; the create-company commit.
- **What was done:** the two library groups kept one file per component, as the open lesson on the library describes
  them; the layout pieces were folded into the files whose part they are. The crop step then added `ImageCropper`,
  `crop.ts` and `LogoZone.tsx`, so the image pieces became a sub-group, `forms/image/` with its own barrel re-exported
  by `forms/index.ts` (`forms/` is at 11 entries); `ui/` stays at 13.
- **Suggested change:** a library group (`components/ui/`, `forms/`, `data/`, `feed/`, `layout/`) is flat by design,
  one file per component with a barrel: raise `folderEntries` for `apps/web/src/components/*/`, or list them with the
  server's platform files as folders whose growth is expected. The alternative, sub-folders by kind inside a group
  (`forms/logo/`), would hide components from the barrel's one-level listing.
- **Status:** `adopted` (S3 structure review, 2026-11-06: library groups warn at 20 0f3be90).

### 2026-11-04: The component library, a shared class helper and a development-only gallery

- **What happened:** the redesign gave the web a reusable component library (about 60 components) and a gallery to
  look at them. The placement table's UI row names only `pages/`, `components/`, `app/`, `api/` and `styles/`: it
  says nothing about how `components/` is grouped, where a helper every component imports goes, or where a page
  that is development tooling rather than a route of the product belongs. Three warnings followed: `big-folder` on
  `components/` (14 entries once the role folders existed beside the loose files), `fan-in` on
  `components/cx.ts` (33 importers: the class-joining helper, like `api/types.ts` imported everywhere) and
  `long-function` on nine new components over 60 lines (gallery sections and the feed pieces).
- **Where:** `apps/web/src/components/{ui,forms,data,feed,layout,auth,overview,company,members,api-keys,settings}/`
  with a barrel `index.ts` per library group; `components/cx.ts`; `pages/design/` (the gallery, loaded only with
  `import.meta.env.DEV`, with its sections in `pages/design/gallery/`); `api/attention.ts` (the feed's data hook,
  empty until S5); the three design commits.
- **What was done:** the library is grouped by role (`ui/` primitives, `forms/`, `data/`, `feed/`, `layout/`,
  `auth/`), a page's own parts stay in `components/<area>/`, and the two loose files moved into role folders
  (`company/CreateCompanyForm.tsx`, `auth/ApiStatus.tsx`), so `components/` holds folders and `cx.ts` only. The
  nine long components were split into named pieces. The `cx.ts` fan-in stays: every component joins classes.
- **Suggested change:** placement-table rows for the web: "A shared primitive → `components/ui/` (or `forms/`,
  `data/`, `feed/`, `layout/`, `auth/` by role), with a barrel; a page's own parts → `components/<area>/`; a
  development-only page (the gallery) → `pages/design/`, behind `import.meta.env.DEV`". And leave `components/cx.ts`
  out of `fan-in` with `api/types.ts`, or count only value imports, as the S1.11 lesson suggests.
- **Status:** `adopted` (S3 structure review, 2026-11-06: web rows 7c37c07; the library left out of fan-in bc330a5).

### 2026-11-04: An opt-in test reuses another package's test fixtures by a relative path

- **What happened:** the real-Clerk variant of the S1 acceptance needs a Clerk owner who signs in on the Frontend API, the
  invitee's ticket sign-up and the cleanup, all of which the connector's contract fixtures already do
  (`connectors/identity-clerk/test/fixtures/clerk-target.ts`, 250 lines, and `fapi.ts`, 161). The placement table says a
  test helper several packages use goes to `packages/testkit` or is exported from its owner's `src/`; either would put about
  400 lines of network code under the coverage floors, tested only by an opt-in run or by new fakes written for it.
- **Where:** `apps/server/test/fixtures/acceptance/clerk.ts` (a dynamic
  `import('../../../../../connectors/identity-clerk/test/fixtures/clerk-target.ts')`, loaded only when the run starts, so the
  default lanes never load the Clerk SDK); the fixtures gained `signIn`, `signUpWithInvitation`, `Fapi.signInWithTicket` and
  `Fapi.sessionToken`; S1.12.
- **What was done:** the relative import, said in the file's header and in docs/testing.md ("S1 acceptance").
- **Suggested change:** decide one of: export the Clerk test helpers as `@mwc/identity-clerk/testing` with fake-fetch tests
  (then the import is a package import), or allow an opt-in test to import another package's `test/fixtures/` and say so in
  the placement table.
- **Status:** `adopted` (S3 structure review, 2026-11-06: the relative import allowed, placement row 7c37c07).

### 2026-11-04: Scenario tests have no place in the placement table or the mirroring rule

- **What happened:** S1.12's acceptance is one story across the identity, companies, members and api-keys modules and the
  jobs loop, over the whole HTTP API: there is no source file for it to mirror, and the placement table names only tests that
  mirror `src/` and helpers in `test/fixtures/`. The story needed 6 helper files (target, world, steps, paths, checks, the
  Clerk target; 45 to 236 lines), which would have taken `apps/server/test/fixtures/` from 9 entries to 15 (`big-folder`).
- **Where:** `apps/server/test/scenarios/s1-acceptance.test.ts` (97 lines) and `s1-acceptance-clerk.test.ts` (92), helpers
  in `apps/server/test/fixtures/acceptance/`; the map line and the server section of docs/structure.md; S1.12.
- **What was done:** `test/scenarios/` for the stories, a folder under `test/fixtures/` per scenario for their helpers, and a
  line on the map. The structure rules already allow both (tests anywhere in `test/`, helpers anywhere in `test/fixtures/`).
- **Suggested change:** a placement-table row: "A scenario: a story across modules over the HTTP API (a stage's acceptance)
  → `apps/server/test/scenarios/`, its helpers in `test/fixtures/<scenario>/`", and the mirroring rule of the skill naming
  it as the exception.
- **Status:** `adopted` (S3 structure review, 2026-11-06: placement row 7c37c07).

### 2026-11-04: The first web pages: placements the table does not name, and nine fan-in warnings

- **What happened:** S1.11 built the web's identity pages (47 files in `apps/web/src`, the largest 152 lines). The
  placement table's UI row ("`apps/web/src/` `pages/`, `components/`, `app/`, `api/`, `styles/`") does not say where a
  React hook, a React context, the router or a page's own components go. The first draft had 13 components over 60 lines
  (`long-function`; JSX tables and pages, the longest `MembersPage` at 117 lines) and 7 web `fan-in` warnings, so the
  report went from 20 to 40. Splitting the components into rows, panels and hooks (`MemberRow`, `KeyRow`,
  `InvitationRow`, `PeoplePanel`, `InvitationsPanel`, `KeysPanel`, `useRoleChange`, `useCompanyMembership`, ...)
  removed every web `long-function`, but added importers to the UI primitives: the report ends at 29 after
  `pnpm mwc check` (28 after `--full`, whose Postgres run covers `outbox-drain.ts`), the baseline plus 9 web `fan-in` (`api/types.ts` 22 importers, `api/errors.ts` 18, `components/ui/Button.tsx` 16,
  `app/router.tsx` 15, `api/context.ts` 14, `components/ui/Badge.tsx`, `Loading.tsx`, `PageHeader.tsx` and `Panel.tsx`
  8 each). `api/types.ts` is imported for types only, by every file.
- **Where:** `apps/web/src/app/` (shell, router, session gate, contexts), `api/` (client, errors, inferred types, the
  `useLoad` hook, the config and API contexts), `components/ui/` (primitives), `components/{members,api-keys,settings}/`
  (one page's parts each), `pages/` and `pages/{auth,company}/`; S1.11.
- **What was done:** hooks that call the API (`useLoad`) and the contexts holding API state (`ApiContext`,
  `PublicConfigContext`) went to `api/`; the session, the company context, the router and the shells to `app/`; a
  hook used by one component stays in that component's file; a page's own pieces got a folder per area under
  `components/`. The fan-in stayed: these files are the web's platform, as `platform/env.ts` is the server's, and a
  barrel or a merged file would only move the count.
- **Suggested change:** placement-table rows for the web: "A hook or context that calls the API → `apps/web/src/api/`;
  the session, router and shells → `app/`; a page's own components → `components/<area>/`; shared primitives →
  `components/ui/`." And leave `apps/web/src/components/ui/` and `apps/web/src/api/` out of `fan-in` (or count only
  value imports, the S1.4 lesson), as the open lessons suggest for the server's platform files.
- **Status:** `adopted` (S3 structure review, 2026-11-06: web rows 7c37c07; `api/` and the library left out of fan-in bc330a5).

### 2026-11-04: The jobs loop made the outbox a fan-in warning

- **What happened:** `platform/jobs/outbox.ts` had 7 importers (five members service files and two companies service
  files: the ones that enqueue and the ones that own handlers). S1.10's loop is its consumer: `outbox-drain.ts` runs
  `processOutboxRow` and needs `OutboxGiveUpError` and the handler types, and `run.ts` types the modules' registry with
  `OutboxHandlers`. They made 9 importers and a `fan-in` warning (the report went from 19 to 20). Any placement of the
  loop adds at least one importer: the drain inside `outbox.ts` would still be imported by `run.ts` or `app.ts`.
  The same step first had two more warnings that were fixed: `createJobsRunner` as one closure of 99 lines
  (`long-function`; now a small class, `JobsLoop`, whose longest method is about 20 lines) and `reserveSession` in a
  file of its own, which made `packages/db/src/` and `test/` 13 entries each (`big-folder`; it now sits in `handle.ts`
  with `queryRows`, the other driver difference, and its tests in `handle.test.ts`).
- **Where:** `apps/server/src/platform/jobs/outbox-drain.ts` (94 lines), `run.ts` (78), `runner.ts` (146);
  `packages/db/src/handle.ts` (117); S1.10.
- **What was done:** kept both imports. Moving `OutboxGiveUpError` and the handler types into a lower file that
  `outbox.ts` re-exports would have kept the count at 7, but only by hiding the loop's dependency behind a facade, which
  the earlier lessons decline.
- **Suggested change:** the open suggestion of counting a module's files as one importer would make `outbox.ts` 3
  importers (members, companies, `platform/jobs`); counting only value imports (the S1.4 lesson) would make it 8.
  Either keeps the warning for real surprises.
- **Status:** `adopted` (S3 structure review, 2026-11-06: a module counts once for fan-in bc330a5).

### 2026-11-04: A new module made the route helpers fan-in warnings

- **What happened:** S1.9's `modules/api-keys/routes.ts` is the eighth file of the server that imports
  `platform/http/router.ts` (`newRouter`) and `platform/http/docs.ts` (`jsonBody`, `jsonResponse`), so both became
  `fan-in` warnings (fan-in 6 to 8), as the S1.6 and S1.8 lessons predicted. A module of its own needs a router and
  its OpenAPI shapes; no placement avoids the imports without copying the helpers. In the same step
  `packages/cli/src/main.ts` left `low-coverage` (95.65% lines and 88.88% branches before, 96% and 90.38% after) with
  the account commands' dispatch tests, so the report went from 18 to 19 warnings.
- **Where:** `apps/server/src/modules/api-keys/routes.ts` (125 lines); S1.9. The importers of `router.ts`: the identity
  and health routes, the three companies route files, the two members route files, api-keys; of `docs.ts`: `app.ts`,
  `platform/auth/membership.ts`, the identity routes, two companies and two members route files, api-keys.
- **What was done:** kept the imports. Mounting the companies groups without `newRouter()` (as `members/routes.ts`
  does) would have brought `router.ts` back to 7 importers, but only to move the count: S2's `org/` would add it again.
- **Suggested change:** adopt the open suggestion of counting a module's files as one importer for `fan-in`, or list
  the platform files meant as every module's API in `rules.ts` and leave them out. Until then these two warnings stay,
  and later modules add no more of them.
- **Status:** `adopted` (S3 structure review, 2026-11-06: a module counts once for fan-in bc330a5; `platform/http/errors.ts` and `docs.ts` stay as the real hubs).

### 2026-11-04: Code two packages run that is not a contract

- **What happened:** `mwc login` (S1.9) writes the saved logins, `~/.config/mwc/credentials.json`, that S2.6's
  `@mwc/mcp` will read. The file helpers do I/O (the file system, the home folder, an atomic rename), so they are no
  contract for `packages/shared` ("zod schemas, ids, enums, protocols"), and the placement table says "exported from the
  owner's `src/`" only in its test helper row. The API key format, which the server and the CLI both check, is a
  contract.
- **Where:** `packages/cli/src/credentials.ts` (184 lines), exported as `@mwc/cli/credentials`;
  `packages/shared/src/api-keys.ts` (the format, moved from `apps/server/src/platform/auth/api-keys.ts`); S1.9.
- **What was done:** the helpers stay with their owner, the CLI, as a subpath export (as `@mwc/identity-core/fake` is
  for the identity test doubles); the format went to `@mwc/shared/api-keys`, and the server's `platform/auth/api-keys.ts`
  re-exports `API_KEY_PATTERN` and `apiKeyKind`, so no import moved.
- **Suggested change:** a placement-table row: "Runtime code another package reuses, not a contract → its owner's
  `src/`, as a subpath export (`@mwc/cli/credentials`); a contract both sides check → `packages/shared`." If `@mwc/mcp`
  needs more of the CLI (an API client), a small `packages/client` both depend on may fit better.
- **Status:** `adopted` (S3 structure review, 2026-11-06: placement row 7c37c07).

### 2026-11-04: The fan-in warning decided where a route went

- **What happened:** S1.8's webhook route first went into its own file, `modules/identity/routes/webhooks.ts`, as
  the module template suggests for a route group. It imports `platform/http/router.ts` (`newRouter`), `docs.ts`
  (`jsonResponse`) and `errors.ts`, so `router.ts` and `docs.ts` went from 7 importers to 8 and both became `fan-in`
  warnings (the report went from 18 to 20), as the open lesson on the error helpers predicted.
- **Where:** `apps/server/src/modules/identity/routes.ts` (72 to 115 lines); its tests in
  `apps/server/test/modules/identity/routes/webhooks.test.ts`, split from `routes.test.ts` (318 lines) along the
  route group, so the test path has no `src/.../routes/webhooks.ts` to mirror; S1.8.
- **What was done:** the route went into the module's one `routes.ts` (three routes, each config a factory outside
  the router function), which adds no importer; the report is back at 18. The tests stayed in their own file:
  appended to `routes.test.ts` they would have reached about 490 of 500 lines (`near-limit`).
- **Suggested change:** adopt the open lesson's change (count a module's files as one importer for `fan-in`), so a
  module can split its routes by group without the report growing; and allow a test file split along a seam of one
  source file (`test/x/<part>.test.ts` for `src/x.ts`) in the mirroring rule of the skill.
- **Status:** `adopted` (S3 structure review, 2026-11-06: fan-in bc330a5; route groups and test splits in the placement table 7c37c07).

### 2026-11-04: Invitations and their acceptance live in two modules that call each other

- **What happened:** the map puts invitations in `members/` and sync and webhooks in `identity/`. S1.7 followed it:
  invitations, their routes and the `invite` / `revoke_invite` handlers in `members/`, the acceptance paths
  (`projectIdentityEvent`, `reconcileCompany`, `POST .../sync`) in `identity/service/sync.ts`. After projecting, sync
  must queue `remove_member` for a provider membership it refused, and that call's payload and handler belong to
  `members/service/provider.ts` (`queueProviderRemovals`). So `identity/service/sync.ts` imports a members service,
  while `members/` already imports `identity/service.ts` (`profilesOf`, `subjectOf`, now `userOfSubject`). There is no
  file-level cycle (`identity/service.ts` does not import `sync.ts`), but the two modules depend on each other, and
  the sign-in path (`identity/service.ts`) cannot queue removals without making one, so it leaves them to the next
  sync or webhook. A related trap: a read through another module's service runs on the `DbHandle`, so inside a tenant
  transaction it waits forever on PGlite's one connection (the first draft of `createInvitation` hung 42 tests this
  way); the member emails are now read before the transaction.
- **Where:** `apps/server/src/modules/identity/service/sync.ts` (186 lines), `modules/members/service/provider.ts`
  (159), `modules/members/service/invitations.ts` (`memberEmails`); S1.7.
- **What was done:** kept the map's split; the removal is queued through the members service that owns its handler.
  Importing `platform/jobs/outbox.ts` into `sync.ts` instead would also have made it an eighth importer (`fan-in`).
- **Suggested change:** a placement-table row: "A rule about invitations that the projection paths apply (expiry,
  refused acceptances) → the members module's service, called by the identity paths; identity owns only the store
  and the paths." Or move sync to `members/` and keep `identity/` for the store, `me` and the webhook inbox. And a
  line in the module template: "never call another module's service inside a tenant transaction; read before it".
- **Status:** `adopted` (S3 structure review, 2026-11-06: "never call another module's service inside a tenant transaction" in the Never list 7c37c07; the split stays as it is).

### 2026-11-04: A repo factory of method literals becomes a long function

- **What happened:** `membersRepo()` returns an object literal of methods (the template's `repo.ts`). S1.7 added eight
  invitation queries to it and the factory became a 92-line `long-function` (the report went from 18 to 19).
- **Where:** `apps/server/src/modules/members/repo.ts` (130 lines); S1.7.
- **What was done:** the new rows moved to a module-level object, `invitationRows`, that the factory spreads in; the
  report is back at 18. The S1.6 methods stayed where they were.
- **Suggested change:** show named functions bound by a short factory in the template's `repo.ts` (as the companies
  service does), or split a repo by entity (`repo/invitations.ts`) once it serves two tables.
- **Status:** `adopted` (S3 structure review, 2026-11-06: `repo/<entity>.ts` in the placement table, named functions in the module template 7c37c07).

### 2026-11-04: Every company module's routes import the platform's error helpers

- **What happened:** S1.6's members routes need `errorJson` (a service refusal as the common error body) and
  `errorResponse` (an error response in the OpenAPI document), like every route file before them, so
  `apps/server/src/platform/http/errors.ts` went from 7 importers to 8 and became a `fan-in` warning (the report went
  from 17 to 18). Its importers are `app.ts`, `platform/auth/authn.ts`, `platform/auth/membership.ts`,
  `platform/http/router.ts`, `modules/identity/routes.ts`, `modules/companies/routes/collection.ts`,
  `modules/companies/routes/company.ts` and `modules/members/routes.ts`. `platform/http/router.ts` (6 importers) and
  `docs.ts` (5) follow the same curve: each new company module adds one or two route files. A second warning, on
  `platform/auth/actor.ts` (9 importers, all for its types), was avoided by narrowing the members services to the acting
  membership's id, which they read again under the company's lock anyway.
- **Where:** `apps/server/src/modules/members/routes.ts` (S1.6). The same step moved the company route base S1.5 had in
  `modules/companies/routes/company.ts` to `platform/auth/membership.ts` (`companyRoute`), since members needed the same
  one, and the outbox handlers' `providerOf` / `openTenant` from `modules/companies/service/organizations.ts` to
  `platform/jobs/outbox.ts` (`outboxProvider`, `outboxTenant`).
- **What was done:** kept the direct import. A barrel or a facade that re-exports `errorJson` would move the count to
  another file without changing who depends on the error contract.
- **Suggested change:** in `packages/cli/src/structure/warnings.ts`, count a module's files as one importer (fan-in
  across areas, not files), or list the platform files that are meant to be every module's API (`platform/env.ts`,
  `platform/http/errors.ts`, `docs.ts`, `router.ts`, `platform/auth/actor.ts`) in `rules.ts` and leave them out of
  `fan-in`. Either keeps the warning for files whose fan-in is a surprise.
- **Status:** `adopted` (S3 structure review, 2026-11-06: a module counts once for fan-in bc330a5).

### 2026-11-04: A module that reads across the caller's companies

- **What happened:** S1.5's `GET /api/companies` lists the caller's companies, and the creation policy reads the
  creator's primary email. Both read across companies or global tables (`memberships` of one user everywhere,
  `users`), which a company's `TenantDb` cannot do, and the companies module may not import `@mwc/db/system`. The
  placement table only knows "SQL through `tenant(db, companyId)`".
- **Where:** `apps/server/src/modules/companies/service.ts` (`listCompanies`, `policyRefusal`) calling
  `apps/server/src/modules/identity/service.ts` (`companiesOf`, `profileOf`; 139 to 147 lines), whose repo has the raw
  access exemption; S1.5.
- **What was done:** the companies module calls the identity module's service, which reads through its exempted
  repo, so `GET /api/companies` lists exactly what `GET /api/me` lists, from one query. No new Biome exemption.
- **Suggested change:** a placement-table row: "A read across the caller's companies, or of a person's own profile
  → the identity module's service (`companiesOf`, `profileOf`), never a new raw-access exemption."
- **Status:** `adopted` (S3 structure review, 2026-11-06: placement row 7c37c07).

### 2026-11-04: The module template's routes grew into a long function and an untyped context

- **What happened:** S1.5 followed the template's `routes.ts`: every `createRoute` inside the router factory and
  `middleware: [authn(deps), requireMembership(deps, role)]`. With five routes the factory was 116 lines (the
  report's `long-function`), and the array literal did not type `c.var.tenant` or `c.var.membership` (zod-openapi
  reads the middleware's environment from a tuple only), so the handlers did not typecheck. The route tests in one
  file reached 430 lines (`near-limit`). A shared route base with `path` typed as `string` also collapsed the web's
  typed client (`apps/web/src/api/client.ts` failed to typecheck).
- **Where:** `apps/server/src/modules/companies/routes.ts` (14 lines now), `routes/collection.ts` (60),
  `routes/company.ts` (104), tests mirrored in `test/modules/companies/routes/` (243 and 210 lines);
  `platform/auth/membership.ts` (`companyMember`); `platform/http/docs.ts` (`jsonBody`, `jsonResponse`) and
  `platform/http/errors.ts` (`errorResponse`); S1.5. The service factory had the same `long-function` (137 lines)
  and became named functions (`createCompany`, `updateCompany`, `removeCompany`, ...) bound by a short factory.
- **What was done:** route configs are factories outside the router function, the routes are grouped by path in
  `routes/` and mounted by `routes.ts` with `.route('/', ...)`, `companyMember(deps, role)` returns the tuple, the
  shared path is `as const`; the module template now shows this pattern. The report stayed at 17 warnings.
- **Suggested change:** confirm the template's new `routes.ts` example; consider a placement-table note that a
  module's routes become `routes/<path group>.ts` once they pass about three routes.
- **Status:** `adopted` (S3 structure review, 2026-11-06: route groups in the placement table 7c37c07).

### 2026-11-04: Splitting the near-limit fake moved its warning to fan-in

- **What happened:** S1.4 needed the fake identity provider to check token claims (`iss`, `azp`, `exp`, `nbf`, and a
  `sid`), so server tests refuse a wrong issuer, a wrong origin and an expired token for real. `fake.ts` had been at
  290 of 300 lines since S1.0b (the report's `near-limit`). It was split by concern: token verification to
  `fake/tokens.ts` (22 → 95 lines), organizations to `fake/organizations.ts` (44), invitations to
  `fake/invitations.ts` (73); `fake.ts` went from 290 to 230 lines, and its tests moved along the same seams (25
  tests before and after). Each new part implements a port method and takes the port's own input type
  (`CreateOrganizationInput`, `CreateInvitationInput`, `VerifyTokenContext`), so `provider.ts` went from 7 importers
  to 10 and became a `fan-in` warning. The report stayed at 17 warnings in all, but one kind turned into another.
- **Where:** `packages/identity-core/src/fake.ts`, `src/fake/`, `test/fake/` (S1.4).
- **What was done:** kept the type imports; copying the port's types into each part to stay under the threshold
  would have been worse.
- **Suggested change:** in `packages/cli/src/structure/warnings.ts`, count only value imports for `fan-in` (or skip
  `import type`). A port module such as `provider.ts` or `store.ts` is meant to be imported for its types.
- **Status:** `adopted` (S3 structure review, 2026-11-06: type imports skipped for fan-in bc330a5).

### 2026-11-04: Test-only routes for a platform guard

- **What happened:** `requireMembership(role)` (S1.4) guards `/api/companies/:companyId/...`, but the first real
  company route arrives with S1.5. The placement table has no row for a route that only tests need.
- **Where:** `apps/server/test/fixtures/auth.ts` (`mountProbe`, `authWorld`), used by `test/platform/auth/*.test.ts`.
- **What was done:** the probe routes (`GET /api/companies/:companyId/probe/<role>`, `authn()` then
  `requireMembership(role)`) live in the test fixture and are mounted on `createTestApp().app` after `createApp`,
  as `test/app.test.ts` already mounts `/test/clock`. Production wiring has none.
- **Suggested change:** a placement-table row: "A route only tests need (a probe for platform middleware) →
  the package's `test/fixtures/`, mounted on the test app; never in `src/`."
- **Status:** `adopted` (S3 structure review, 2026-11-06: placement row 7c37c07).

### 2026-11-04: A cross-tenant store has no row in the placement table

- **What happened:** S1.3 needed a database `IdentityStore`. The placement table sends SQL to
  `modules/<area>/repo.ts` "through `tenant(db, companyId)`", but the projector reads across companies (a
  person's memberships everywhere, an invitation found by its id alone, companies by organization id) and
  writes global tables (`users`, `user_identities`, `identity_marks`, `identity_parked_events`), so no single
  company's tenant fits. The table has no row for a store that must see every company.
- **Where:** `apps/server/src/modules/identity/repo.ts` (117 lines) and `repo/` (users 68, memberships 95,
  invitations 53, bookkeeping 37 lines); the exemption in `biome.json`; S1.3. S1.4 added `repo/me.ts` (67 lines),
  the reads of `GET /api/me` across a person's companies, under the same exemption.
- **What was done:** the store sits where the map puts the identity area, as its `repo.ts` with a `repo/` folder,
  and reads the raw database (`@mwc/db/system`). `biome.json` forbids that entry in `apps/server/src/modules/**`
  and turns the rule off for exactly `modules/identity/repo.ts` and `modules/identity/repo/**`;
  `packages/db/test/system.test.ts` proves both. `docs/structure.md` ("The tenant layer") says so.
- **Suggested change:** a placement-table row: "A store that must see every company (the identity store, later
  the runner hub) → `modules/<area>/repo.ts` with raw access, listed in the `biome.json` exemption", or move such
  stores to `platform/` if Ihor prefers modules to hold tenant code only.
- **Status:** `adopted` (S3 structure review, 2026-11-06: placement row 7c37c07).

### 2026-11-04: The testkit barrel loads the whole server

- **What happened:** `@mwc/testkit`'s `src/index.ts` re-exports `createTestApp`, so importing the barrel loads
  `@mwc/server` and `@mwc/db`. The Clerk connector's tests (S1.2) need only the provider contract and the svix
  signer, which import neither. The connector's first draft also put 13 entries in `src/` and 14 in `test/`
  (the `big-folder` warning), and a 93-line function in its contract target.
- **Where:** `packages/testkit/package.json` (exports), `connectors/identity-clerk/` (S1.2).
- **What was done:** the two testkit helpers that do not need the server got their own subpath exports,
  `@mwc/testkit/provider-contract` and `@mwc/testkit/webhooks` (also re-exported by the barrel), and the
  connector imports those. The connector's Backend API pieces moved to `src/backend/` (client, calls, errors,
  rate limit, mappers; tests mirrored), and the contract target was split into named steps, so the report is
  back at its S1.0d count.
- **Suggested change:** a line in the placement table's testkit row: a shared test helper that does not need
  the server or a database gets its own `@mwc/testkit/<name>` subpath export.
- **Status:** `adopted` (S3 structure review, 2026-11-06: placement row 7c37c07).

### 2026-11-04: Four source files grew past 300 lines before there was a limit

- **What happened:** No size limit existed until S1.0b, so four source files grew past 300 lines and two test
  files past 500:
  - `packages/identity-core/src/projector.ts`: 528 lines (S1.1);
  - `packages/identity-core/src/fake.ts`: 456 (S1.1);
  - `packages/db/src/diagram.ts`: 418 (S0.2b);
  - `packages/cli/src/main.ts`: 344 at S1.1, 339 after S1.0a;
  - the identity-core tests `projector.test.ts` (791) and `fake.test.ts` (554).
- **Where:** c0592f5 (S1.0b) split them.
- **What was done:** each file was split by responsibility, with behaviour and public import paths unchanged:
  - `projector.ts`: the dispatch (`project`, `replayDeferred`) stayed and is 102 lines now. The handlers moved
    to `projector/` (`users`, `memberships`, `membership-link`, `invitations`) and the shapes to
    `projector/changes.ts`. The user handler gets a `replay` callback instead of importing the entry, so there
    is no cycle.
  - `fake.ts`: the provider class stayed. Its state and dashboard actions moved to `fake/world.ts`, token parsing
    to `fake/tokens.ts` and webhook signing to `fake/webhooks.ts`.
  - `diagram.ts`: the page (`renderSchemaDiagram`) stayed, with `diagram/describe.ts`, `diagram/mermaid.ts`
    and `diagram/markdown.ts` beside it.
  - `main.ts`: the dispatch stayed. The check lanes moved to `check.ts` and the shared io to `io.ts`.
  - The two test files were split by `describe` block into files that mirror the new sources, with their helpers
    in `test/fixtures/`. Every test body stayed the same.
  The `size` rule has enforced 300/500 lines since then.
- **Suggested change:** warn before the limit, not only at it. That became the `near-limit` warning in S1.0d.
  `fake.ts` left its split at 290 lines and is still 290, 97% of the limit; the first report lists it at the top.
- **Status:** `adopted` (the limit in S1.0b, c0592f5; the warning in S1.0d).

### 2026-11-04: Tests were mixed into src/

- **What happened:** From S0.1 to S1.1, tests sat next to the code. There were 30 test files under `src/` in
  six packages (`apps/server` 6, `packages/db` 7, `packages/identity-core` 6, `packages/shared` 5,
  `packages/cli` 4, `packages/testkit` 2). Examples: `apps/server/src/app.test.ts`,
  `packages/cli/src/main.test.ts`. The identity test world lived in `packages/identity-core/src/test-world.ts`,
  and the web's Playwright specs in `apps/web/e2e/`.
- **Where:** 64a9536 (S1.0a), c0592f5 (S1.0b).
- **What was done:**
  - S1.0a moved the tests with `git mv` into each package's `test/`, mirroring `src/`, and `test-world.ts` became
    `test/fixtures/world.ts`.
  - Test support that other packages import stayed in `src/`: `@mwc/db/testing`, `@mwc/identity-core/fake` and
    `/memory-store`, and `@mwc/testkit`.
  - The Playwright smoke was removed (no frontend tests for now).
  - S1.0b added the `tests` rule: no test under `src/`, and nothing in `test/` but tests and `test/fixtures/`.
- **Suggested change:** none left. The `tests` rule and the placement-table rows for test helpers cover it.
- **Status:** `adopted` (S1.0a, 64a9536; S1.0b, c0592f5).

### 2026-11-04: There was no folder map before code was written

- **What happened:** The ten commits from S0.1 to S1.1 (2026-11-03 to 2026-11-04) were written with only a list
  of packages in CLAUDE.md's Layout section. Nothing said what goes inside a package. The result:
  - the server kept its routes in `src/routes/` (`health.ts`, `meta.ts`, `docs.ts`, `web.ts`) beside loose
    platform files (`env.ts`, `logger.ts`, `shutdown.ts`, `version.ts`, `http/`);
  - its startup was in the 49-line `src/main.ts`;
  - the demo server was `src/dev-memory.ts`;
  - the web was flat files (`src/api.ts`, `src/App.tsx`, `src/Home.tsx`, `src/styles.css`);
  - tests sat next to the code (the entry above).
- **Where:** 64a9536 (S1.0a, 102 files changed).
- **What was done:**
  - S1.0a wrote `docs/structure.md` (the map and its rules) and moved the repository into it: `platform/` and
    `modules/health/` in the server, `main.ts` a 3-line entry over `platform/start.ts`, the web in `app/`,
    `pages/`, `api/` and `styles/`.
  - S1.0b enforced the map in `mwc check`.
  - S1.0c (9d1af56) added this skill and its placement table.
- **Suggested change:** none to a rule. A new area, package or connector gets its line on the map before its
  first code (step 1 of "New server module", step 5 of "New workspace package or connector").
- **Status:** `adopted` (S1.0a to S1.0c).

