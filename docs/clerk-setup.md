# Clerk setup

How the Clerk application behind v2 is configured, which variables the Clerk connector
(`connectors/identity-clerk`, `@mwc/identity-clerk`) reads, how to run its contract test against the real
development instance, and how to point Clerk's webhooks at a local server (S1.8). The identity model itself
is in `packages/identity-core/README.md` and `docs/architecture.md` ("Identity flow").

## The application

| What                | Value                                                         |
| ------------------- | ------------------------------------------------------------- |
| Application         | "Most Wanted Corp v2", `app_3LdvlESKIxsDnLqnAw0v22ysBWP`      |
| Instance            | development, `ins_3LdvlChsJjqtEoCtpVZ8cfx9wgX`                |
| Frontend API        | `robust-koala-7286.clerk.accounts.dev` (the token issuer is `https://robust-koala-7286.clerk.accounts.dev`) |
| Plan                | Hobby (5 members per organization)                            |

Ihor owns the application and its dashboard. Only the development instance exists; a production instance
comes with the cloud deployment (S8) and gets the same checklist.

## Settings checklist

Set on 2026-11-04. Membership was changed from "required" to "optional"; everything else is the
default of a new B2B application with these sign-in choices.

| Setting (dashboard)                                              | Value                         | Why                                                                  | Checked by the contract run                      |
| ---------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------- | ------------------------------------------------ |
| Organizations                                                    | on                            | a company is a Clerk organization                                    | Backend API organization settings: `enabled`     |
| Membership                                                       | **optional** (personal accounts allowed), changed from required on 2026-11-04 | a new person must not be stuck with `sts=pending` before their first company exists | indirectly: a fresh user's session token is not pending |
| Members per organization                                         | 5 (the Hobby limit)           | plan limit; enough for the S1 tests                                   | Backend API: `maxAllowedMemberships` 5; Frontend API: `max_allowed_memberships` 5 |
| Organization creator role                                        | `org:admin` (default)         | the creator is the first admin; owner is a local decision             | Backend API: `creatorRole`                       |
| Organization roles                                               | `org:admin`, `org:member` (defaults, no custom roles) | the connector's role map (below)                    | the contract: invitations and role updates use exactly these |
| Email address                                                    | required, verified at sign-up | identity is `(issuer, subject)`, but every person needs a working email | Frontend API environment: `email_address` `required`, `verify_at_sign_up` |
| Sign-in with email                                               | email verification code       | no passwords                                                          | Frontend API environment: `first_factors` has `email_code` |
| Google                                                           | on (Clerk's shared development credentials) | one-click sign-in                                       | Frontend API environment: `oauth_google.enabled` |
| Organization invitations                                         | on (default)                  | Clerk sends the invitation email                                      | the contract: create, list, revoke, accept       |
| Webhooks                                                         | none yet                      | reconcile is the default; the endpoint exists since S1.8 (below)      | no                                               |

The Backend API does not expose the email and sign-in settings, so the contract run reads them from the
Frontend API's public `/v1/environment` (what Clerk's sign-in components load). Nothing in the API says
"personal accounts allowed" directly: the contract creates a user who belongs to no organization, mints a
session for them and checks that the token is not `pending`, which it would be while membership is required.

## Role map

| Ours   | Sent to Clerk | Read back from Clerk                                |
| ------ | ------------- | --------------------------------------------------- |
| owner  | `org:admin`   | —                                                   |
| admin  | `org:admin`   | `org:admin` → admin (admin-like; never owner)       |
| member | `org:member`  | `org:member` → member                               |
| viewer | `org:member`  | (anything else → member)                            |

Clerk has no owner and no viewer: those are local decisions, and the projector keeps them (rule 4 in
`packages/identity-core/README.md`).

## Invitations (S1.7)

What the invitation flow relies on, and what is still unverified against the development instance (the contract
run of S1.2 is pending):

- **The emailed link** lands on `<MWC_WEB_ORIGIN>/accept-invitation` (the `redirectUrl` of each invitation): the web
  dev server in development, the public URL in production. The page itself comes with S1.11.
- **The private metadata reaches the membership.** An accepted membership is linked to our invitation by
  `mwc_invitation_id` in the membership's private metadata (Clerk's membership objects carry no invitation id). If
  Clerk does not copy it, `organizationInvitation.accepted` (and the reconcile's invitation list) still marks the
  invitation accepted, but the membership is refused as unlinked and the person is not activated. The contract run
  checks this; until then it is the flow's main open risk (`docs/plan-2026-11-03.md`, section 18).
- **The member limit** (5 per organization on the Hobby plan) is Clerk's, not ours: nothing counts members here.
  When Clerk refuses an invitation for it (its error code is `organization_membership_quota_exceeded`), the `invite`
  outbox row records Clerk's message as `last_error`. Answered with a 4xx that maps to `invalid`, the row fails at
  once and the invitation turns `failed` (its email is free again); answered with 403 (`unauthorized`), it is tried
  again until its last try, which fails both. Which status Clerk uses is one of the things the contract run will show.
- **Expiry.** Invitations are sent with the days our invitation has left (14 for a new one or a resend); our
  `expires_at` decides: an acceptance after it activates nobody, and the membership is removed at Clerk.
- **Resend** revokes Clerk's invitation and sends a new one with the same metadata (the Backend API has no resend for
  organization invitations); `organizationInvitation.revoked` for the old one is ignored.

## Environment

The connector reads these variables (`clerkConfigFromEnv`); `.env.example` lists them with empty values.
Real values go in `.env` or `.env.local` at the repository root (both ignored; `.env.local` wins), never in
a committed file. A bad value fails with the variable's name, never its value.

| Variable                       | Required | What                                                                                            |
| ------------------------------ | -------- | ----------------------------------------------------------------------------------------------- |
| `CLERK_SECRET_KEY`             | yes      | Backend API key, `sk_test_...` for the development instance                                       |
| `CLERK_PUBLISHABLE_KEY`        | yes      | `pk_test_...`; it encodes the Frontend API host, from which the connector derives the issuer      |
| `CLERK_JWT_KEY`                | no       | the instance's JWT public key (PEM, escaped `\n` allowed): networkless token verification. Without it, tokens are verified with the JWKS that `@clerk/backend` fetches with the secret key and caches |
| `CLERK_WEBHOOK_SIGNING_SECRET` | no       | the webhook endpoint's `whsec_...` secret (S1.8). Without it the connector cannot verify deliveries (its `webhooks` capability is off) and `POST /api/webhooks/clerk` answers 503 `webhooks_not_configured`; the server stays up and reconcile keeps memberships current |

The server reads two more (`@mwc/shared/config`, S1.4):

| Variable         | Default                                                                          | What |
| ---------------- | -------------------------------------------------------------------------------- | ---- |
| `MWC_IDENTITY`   | `clerk` when `CLERK_SECRET_KEY` is set, else `none`                              | `clerk` wires this connector (`apps/server/src/platform/identity.ts`) and needs both keys; `none` keeps health and the UI up and answers 503 `identity_not_configured` on every route behind `authn()` (the prod-like compose stack has no keys) |
| `MWC_WEB_ORIGIN` | `http://localhost:9951` (the slot's web port with `MWC_PORT_SLOT`); in production the origin of `MWC_PUBLIC_URL` | the web origin session tokens must be issued to: the server passes it as `authorizedParties` (Clerk's `azp`) on every `verifyAccessToken` |

## How the connector uses Clerk

- **Tokens:** `verifyToken` of `@clerk/backend` with `CLERK_JWT_KEY` when set, else the JWKS; issuer
  `https://<frontend api>`; the caller's authorized parties (Clerk refuses a token without `azp` when parties
  are given); 5 seconds of clock skew. It reads `iss` and `sub` (the identity), `sid`, `sts` (`pending`), and
  the organization claims (`o.id`, or `org_id`) only as a hint.
- **Backend API:** users, organizations (created with `privateMetadata.mwc_company_id`; found again by paging
  the organization list, newest first, since the API cannot search metadata), members (paged), invitations
  (created with `privateMetadata { mwc_invitation_id, mwc_company_id }`, the `redirectUrl` and 14 days of
  validity). Lookups answer null and removals succeed on a 404.
- **Errors:** every failure becomes an `IdentityProviderError`: 404 `not_found`, 401/403 `unauthorized`, 409
  and Clerk's duplicate-like codes `conflict`, other 4xx `invalid`, 5xx and network errors `unavailable`,
  429 `rate_limited` with Clerk's `Retry-After`.
- **Rate limits:** after a 429 the connector refuses that kind of call itself until the `Retry-After` has
  passed (10 seconds when Clerk sends none), and it keeps Clerk's 250-invitations-an-hour budget in a
  sliding window, so the 251st invitation of the hour is refused before it reaches Clerk.
- **Webhooks:** `verifyWebhook` of `@clerk/backend/webhooks` (svix signatures; a timestamp more than 5 minutes
  off is refused), then `user.*`, `organization.*`, `organizationMembership.*` and
  `organizationInvitation.accepted|revoked` become normalized events. The svix id is the event id (S1.8
  dedupes on it), each object's `updated_at` its ordering guard; any other type (such as
  `organizationInvitation.created` or `session.created`) becomes an `ignored` event with its svix id and Clerk
  type, which the server records once and acknowledges.
- **Telemetry:** the SDK's telemetry is switched off.

## The contract test

`packages/testkit` holds one provider contract (`@mwc/testkit/provider-contract`): 16 cases that every
`IdentityProvider` passes in the same way, from a person signing up to the organization being deleted.
It runs against `FakeIdentityProvider` in every `pnpm mwc check`. Against the real development instance it
runs only on request:

```sh
# Is the secret key in place? Prints only yes or no.
node --env-file-if-exists=.env --env-file-if-exists=.env.local \
  -e 'console.log(/^sk_test_[A-Za-z0-9]{20,}$/.test(process.env.CLERK_SECRET_KEY ?? "") ? "yes" : "no")'

pnpm --filter @mwc/identity-clerk contract
```

The script sets `CLERK_CONTRACT_TEST=1` and loads `.env`, then `.env.local`, from the repository root
(`node --env-file-if-exists`); variables already exported in the shell win over both. Without
`CLERK_CONTRACT_TEST=1` (as in `mwc check`) the file reports one skipped test and makes no call.

What a run does (about a minute):

- Every object it creates is named `mwc-contract-<random>`: users with Clerk test emails
  `mwc-contract-<random>-<label>+clerk_test@example.com` (no email is sent for `+clerk_test` addresses), an
  organization with that name and slug, invitations to those emails.
- Users are created through the Backend API without a password; session tokens come from the Backend API
  (`sessions.createSession` and `getToken`, which carry no `azp`).
- The invitee accepts like a person would: the run takes the ticket from the invitation's URL, creates a
  Frontend API dev browser and signs up with the ticket (with a Backend API testing token for bot
  protection). That verifies the test email and accepts the invitation in one step, so the run can check
  that the invitation's private metadata (`mwc_invitation_id`, `mwc_company_id`) is on the new membership.
  The session token of that sign-up carries our origin as `azp`, so the run also checks that it verifies for
  `http://localhost:9951` and is refused for another origin.
- Webhook deliveries are signed with `CLERK_WEBHOOK_SIGNING_SECRET` when set, else with a test secret (the
  real endpoint is not involved).
- Then the settings above are read (Backend API organization settings, Frontend API environment).
- Cleanup runs after the cases even when one fails: it deletes the run's organization (with its
  memberships and invitations) and every user it created or that matches the run's name. A last check lists
  every `mwc-contract-` user and organization in the instance and expects none.

Results of the runs: `docs/roadmap.md`, S1.2.

## Webhooks (S1.8)

Reconcile keeps memberships current without webhooks; webhooks make it immediate. The endpoint is built and tested
with svix-signed test deliveries; pointing the real Clerk development instance at it is done once, with Ihor, for
the two-user test (nothing below has been run against Clerk yet).

**The endpoint:** `POST /api/webhooks/clerk` on the API (9950 locally). No bearer token: the svix signature over the
exact body is the authentication.

| Answer | When |
| ------ | ---- |
| 200 `{ "status": "processed" }` | verified, recorded and projected at once |
| 200 `{ "status": "duplicate" }` | a delivery already received (same svix id): nothing is done again |
| 200 `{ "status": "ignored" }` | an event type this product does not project: recorded, nothing else |
| 200 `{ "status": "failed" }` | verified and recorded, but projecting it failed: the server retries it (backoff from 30 s to 1 h, given up after 12 tries), so Clerk need not |
| 400 `invalid_signature` | a missing or bad signature, or a timestamp more than 5 minutes off: nothing is recorded |
| 400 `invalid_payload` | a signed body that is not JSON or not a valid event: nothing is recorded |
| 413 `payload_too_large` | a body over 512 KB |
| 503 `webhooks_not_configured` | no `CLERK_WEBHOOK_SIGNING_SECRET` (or sign-in is off) |

Each verified delivery is a row of `identity_events`, unique on `(provider, svix id)`. Its changes to memberships and
invitations land in `audit_log` in the same transaction, by the `system`, with the svix id as the request id.

**Hooking it up** (with Ihor, once, for the two-user test):

1. Start the API (`pnpm dev`), then the tunnel: `ngrok http 9950` (its inspect UI is on 9954; `docs/ports.md`). The
   free plan's URL changes on every start.
2. Clerk dashboard → Configure → Webhooks → Add endpoint, with the URL
   `https://<ngrok host>/api/webhooks/clerk`.
3. Subscribe to `user.*`, `organization.*`, `organizationMembership.*` and `organizationInvitation.*`. The connector
   projects `user.created|updated|deleted`, `organization.created|updated|deleted`,
   `organizationMembership.created|updated|deleted` and `organizationInvitation.accepted|revoked`; the others
   (`organizationInvitation.created`, ...) are recorded and ignored.
4. Copy the endpoint's signing secret (`whsec_...`) into `.env.local` at the repository root as
   `CLERK_WEBHOOK_SIGNING_SECRET` (never into a committed file), and restart the API.
5. The dashboard's "Testing" tab sends a sample event: it should answer 200; a delivery replayed from the dashboard
   answers 200 `duplicate`.

Remove or disable the endpoint when the tunnel is down, or Clerk keeps retrying deliveries.
