# @mwc/identity-core

Provider-agnostic identity for Most Wanted Corp v2 (S1.1): the `IdentityProvider` port, the normalized
identity events, the `IdentityStore` port, the order-safe projector, reconcile, and the test doubles. Pure
TypeScript: no identity provider SDK and no database. The Clerk provider (S1.2, `connectors/identity-clerk`)
and the database store (S1.3) plug into the two ports. Background: `docs/architecture.md`, "Identity flow".

```ts
import { project, projectionContext, reconcileOrganization, reconcileUser } from '@mwc/identity-core';
import { FakeIdentityProvider } from '@mwc/identity-core/fake';          // or from @mwc/testkit
import { InMemoryIdentityStore } from '@mwc/identity-core/memory-store'; // or from @mwc/testkit
import { buildScenario, seededRandom, shuffled } from '@mwc/identity-core/scenario'; // test support
```

## The model

- A person is `(issuer, subject)` from a verified token, never an email. Emails are stored lower-cased and
  are never used to link anything.
- The contracts are zod schemas in `@mwc/shared/identity` (re-exported here): `MembershipRole`
  (owner, admin, member, viewer), `MembershipStatus` (invited, active, suspended, removed),
  `InvitationStatus` (pending, accepted, revoked, expired, failed; `failed` is local only),
  `VerifiedIdentity`, the provider's objects `ExternalUser`, `ExternalOrg`, `ExternalMembership` and
  `ExternalInvitation` (each with `updatedAt`, and private metadata where the provider has it), and
  `NormalizedIdentityEvent`: `{ provider, externalEventId, occurredAt, type, data }` with the types
  `user.upserted | user.deleted | org.upserted | org.deleted | membership.upserted | membership.deleted |
  invitation.accepted | invitation.revoked`. Times are milliseconds since the epoch.
- Local state decides access. Companies are local (linked to a provider organization by its id), and a
  membership row holds `grantedRole` (what we granted: the invitation's role or a local change), `role`
  (what applies), `status`, the provider membership it follows (`externalMembershipId`, `providerRole`)
  and the invitation it came from.
- Metadata keys we write to the provider and read back: `mwc_invitation_id` and `mwc_company_id`
  (`IDENTITY_METADATA`).

## The provider port: `IdentityProvider`

`provider.ts` documents each method's contract. In short: `verifyAccessToken` (rejects `unauthorized`;
a session with a pending task verifies with `pending: true`), `getUser` and the lookups answer null for
"does not exist", `listUserOrganizations`, `createOrganization` (not idempotent: find it again with
`findOrganizationByMetadata('mwc_company_id', id)` before a retry), `deleteOrganization` and
`removeMember` (idempotent), `listOrganizationMembers` (an `AsyncIterable` that pages internally),
`updateMemberRole`, `createInvitation`, `revokeInvitation` (idempotent for a revoked one), `listInvitations`,
`parseWebhook({ headers, rawBody })` (verifies the signature, then returns a normalized event, or null for
a type we do not use), plus `kind`, `issuer`, `roles` (the provider's role map: `toProvider`, `isAdmin`) and
`capabilities { organizations, invitations, webhooks, scim }`.

Every failure rejects with `IdentityProviderError`, never an SDK or network error. Callers branch on its
`code`: `not_found`, `conflict`, `rate_limited` (with `retryAfterMs`), `unauthorized`, `invalid`,
`unavailable`; `retryable` is true for `rate_limited` and `unavailable` (the outbox retries those).

`FakeIdentityProvider` (`./fake`, also exported by `@mwc/testkit`) is the in-memory provider for tests:
users, organizations, memberships and invitations that behave like Clerk where S1 depends on it; tokens
`fake:<subject>` with optional `;org=<externalId>` and `;pending`, and `;sid=<id>`, `;iss=<issuer>`, `;azp=<origin>`,
`;exp=<ms>` and `;nbf=<ms>`, which `verifyAccessToken` checks as Clerk checks its claims (another issuer, an origin outside
the caller's `authorizedParties`, expired or not yet valid with 5 seconds of skew on the fake's clock: `unauthorized`);
the parts live in `src/fake/` (`tokens`, `organizations`, `invitations`, `webhooks`, `world`); `createUser`, `updateUser`,
`deleteUser`, `addMember` (a dashboard add) and `accept(invitationExternalId, subject)` (the membership
gets the invitation's role, a copy of its private metadata and its id); every change emitted as a
normalized event with strictly increasing `occurredAt` from an injectable clock (`drainEvents()`);
`failNext(method, error?)` fails exactly the next call of a method; `webhookFor(event)` signs a delivery
with an HMAC in `x-fake-signature` that `parseWebhook` checks.

## The store port: `IdentityStore`

What the projector reads and writes (`store.ts`): users by `(issuer, subject)`, companies by id and by
organization id, memberships by `(companyId, userId)`, invitations by id and by provider id, ordering
marks (`getMark`/`setMark`: the newest provider `updatedAt` applied and a sticky `deleted` flag, keyed by
`identityKeys`), and parked events (`defer`/`takeDeferred`). `InMemoryIdentityStore` (`./memory-store`)
implements it for tests and adds seeding helpers and `snapshot()`, which replaces ids by natural keys so
stores built in different orders compare equal. The database store (S1.3, `apps/server/src/modules/identity/repo.ts`)
implements it on the identity tables. Both pass the IdentityStore contract (`@mwc/testkit/store-contract`): the
port method by method, the convergence below and reconcile against the webhooks.

`./scenario` is test support for that contract and for this package's tests: `buildScenario()` (the provider
history below, with company and invitation ids that are UUIDs made from names, `scenarioId('c-acme')`, the same
on every build), `buildPersonHistory()` (one person's six events), `applyAll`, `fakeWorld()` and seeded
shuffles and permutations.

## The projector

`project(event, store, ctx)` is the one place where provider state becomes local state. Webhooks,
sign-in reconcile, periodic reconcile and "Sync now" all hand it normalized events. It returns
`ProjectionChange[]`: `{ entity, action, id, companyId, fields, reason, eventId }`, where `fields` has the
shape of `@mwc/db`'s `diffFields` (audit rows), and the actions `created | updated | deactivated |
removed | reactivated | accepted | revoked` change something, while `ignored | deferred | refused` are
notes with a reason and no fields.

The same set of events, in any order and any number of times, leaves the same store (the store contract's
convergence cases run 200 seeded shuffles of a 41-event scenario, double deliveries and all 720 orders of one
person's history on the in-memory store, and fewer on the database store). The rules:

1. **Newest provider state wins.** Each user and membership row keeps the `updatedAt` of the newest
   provider state applied; an upsert with an equal or older one is `ignored: not_newer`.
2. **Deletions are sticky.** `user.deleted` deactivates the user for good (a later or older upsert still
   lands deactivated) and removes all their memberships. `membership.deleted` removes the row and is
   remembered by provider membership id, so a stale or later upsert of that membership never makes a row
   active; it is remembered even before the row exists. Deletions never move the marks.
3. **Linking, never by email.** `membership.upserted` links to a local invitation by `mwc_invitation_id`
   in the membership's metadata, else by the provider invitation id it carries. A membership without a
   valid link never creates a row (`refused: unlinked`). A link is refused when the invitation belongs to
   another company, is revoked, expired or failed here, or was accepted by someone else.
4. **Roles come from us.** A new row takes `grantedRole` from the invitation row. The applied role is
   `owner` for a granted owner whatever the provider says; `admin` while the provider role is admin-like
   (`roles.isAdmin`); otherwise the granted role. So a provider never makes an owner, never demotes an
   owner, and never takes anyone below their grant.
5. **Local decisions stay.** A removal made here is not undone by provider changes to the same
   membership. A row is reactivated only by a new provider membership from a valid invitation (a
   re-invite). A provider membership that replaces the one a row follows without a valid invitation (a
   re-add in the provider's dashboard) is refused and changes nothing. A row made here (the company's
   creator) adopts the first provider membership that comes as its own.
6. **Invitations.** `invitation.accepted` and `invitation.revoked` find the local invitation by metadata or
   by provider id (so an invitation without metadata is still marked accepted) and change only a pending
   one; otherwise local decisions win (`refused` for an acceptance of a revoked, expired or failed
   invitation, so S1.7 can remove that membership at the provider). Events about a provider invitation the
   row no longer follows (sent again with the same metadata) are ignored. The provider invitation id is
   learned from any event about the invitation, the membership's included, so every order ends with it.
7. **Parking.** An event whose company is not linked yet is parked under `identityKeys.org(...)` and
   replayed by `org.upserted` or `reconcileOrganization`; one whose user is unknown is parked under
   `identityKeys.user(...)` and replayed by that user's upsert. Organizations themselves are local:
   `org.upserted` only replays, `org.deleted` is ignored (S1.5 owns company deletion).
8. **Refused and repeated events change nothing.** A refused event has no side effect at all, so it
   commutes with every other event; applying an event again returns only notes. Deduplicating deliveries by
   `(provider, externalEventId)` before projecting is the caller's job (S1.3, S1.8).

## Reconcile

`reconcileOrganization(orgExternalId, provider, store)` replays the events parked for the organization,
projects every listed member as a synthetic `membership.upserted` (fetching users not seen yet), every
accepted or revoked invitation as `invitation.accepted`/`invitation.revoked`, and every active local
membership whose provider membership is no longer listed as `membership.deleted`.
`reconcileUser(subject, provider, store)` projects the user (or `user.deleted` when the provider no longer
has them), their memberships in companies we know, and removals of those. Both go through `project`, so
they end where the webhooks end for the same provider state (tested step by step against the scenario),
and return `{ members, invitations, removed, changes }`. Synthetic event ids are
`reconcile:<type>:<id>[:<updatedAt>]`, and `occurredAt` comes from `options.now`. A provider failure
rejects with its `IdentityProviderError`; what was projected before it stays (every step is idempotent).
The organization reconcile does not refresh the profiles of people it already knows; the sign-in
reconcile and user webhooks do.

## How the next steps plug in

- **S1.2 `@mwc/identity-clerk`** (`connectors/identity-clerk`, built; `docs/clerk-setup.md`) implements `IdentityProvider` over `@clerk/backend`: `verifyToken` with
  issuer, authorized parties and `sts`; the Backend API mapped to the `External*` shapes; Clerk errors
  mapped to `IdentityProviderError` (HTTP 429 → `rate_limited` with `Retry-After`); members paged inside
  `listOrganizationMembers`; `parseWebhook` verifying svix and mapping `user.*`, `organization.*`,
  `organizationMembership.*` and `organizationInvitation.accepted|revoked` to normalized events with the
  svix id as `externalEventId`; its role map (`org:admin` admin-like). Its contract test against the dev
  instance checks that an accepted invitation's private metadata reaches the membership (rule 3 depends on
  it, or on the invitation id); the same contract (`@mwc/testkit/provider-contract`) runs against
  `FakeIdentityProvider` in every check. Clerk's membership objects carry no invitation id, so for Clerk the
  link is the metadata (or the `invitation.accepted` event).
- **S1.3 migration and store** (built): `DbIdentityStore` (`apps/server/src/modules/identity/repo.ts`)
  implements `IdentityStore` on the identity tables (users and `user_identities`, `companies.identity_org_id`,
  memberships with `granted_role`, `provider_role`, `external_membership_id`, `invitation_id` and a person
  principal each, invitations, `identity_marks`, `identity_parked_events`); `transaction(work)` projects an event
  in one transaction. Deduplicating on `identity_events (provider, external_event_id)` and writing each change's
  `fields` as audit rows are the webhook inbox's (S1.8).
- **Callers (S1.4–S1.10):** the webhook route (`parseWebhook` → dedupe → `project`), reconcile-on-sign-in
  (`reconcileUser`, built in S1.4: `GET /api/me` in `apps/server/src/modules/identity/service.ts`), the jobs loop and "Sync now" (`reconcileOrganization`), and the outbox, which after
  linking a company to its new organization reconciles it so the creator's parked events apply. S1.7 built the
  server side of the webhook and periodic paths (`projectIdentityEvent`, `reconcileCompany` and
  `POST /api/companies/:companyId/sync` in `apps/server/src/modules/identity/service/sync.ts`): the database store
  reads a pending invitation past its expiry as `expired`, and a provider membership refused because its invitation
  is revoked, expired or failed here is removed at the provider through the outbox (rule 6).

## Known limits

- A row made here (the company creator's) whose provider membership is deleted in the provider's
  dashboard and re-added there without an invitation can end removed or active depending on the order of
  those three events. Our own removals are local first, so this needs dashboard edits.
- Provider deletions carry no time: the projector assumes a deleted user or membership id never comes back
  (true for Clerk). Two different provider states with the same `updatedAt` count as one.
