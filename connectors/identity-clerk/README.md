# @mwc/identity-clerk

The Clerk identity connector (S1.2): `ClerkIdentityProvider` implements `IdentityProvider` of
`@mwc/identity-core` with `@clerk/backend` (pinned, exact version). Setup, settings, variables and the
contract run: `docs/clerk-setup.md`.

```ts
import { createClerkIdentityProvider } from '@mwc/identity-clerk';

const identity = createClerkIdentityProvider(process.env); // CLERK_SECRET_KEY, CLERK_PUBLISHABLE_KEY, ...
```

The server wires it in `apps/server/src/app.ts` (S1.4); modules depend on the port, never on this package.

## Files

| File                  | What                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------ |
| `src/provider.ts`     | the provider: one method per port method                                                   |
| `src/create.ts`       | `createClerkIdentityProvider(env)` and `clerkIdentityProvider(config, backend?)`           |
| `src/config.ts`       | the `CLERK_*` variables, checked; the issuer from the publishable key                       |
| `src/backend/client.ts` | the SDK as a port (`ClerkBackend`: the Backend API, `verifyToken`, `verifyWebhook`) and the real one |
| `src/backend/calls.ts` | each Backend API call behind the rate gate, errors mapped, 404 as null, paging           |
| `src/backend/errors.ts` | Clerk, HTTP and network failures → `IdentityProviderError`                               |
| `src/backend/rate-limit.ts` | 429 + `Retry-After`, and the 250-invitations-an-hour window                         |
| `src/backend/mappers.ts` | Backend API objects → `External*`                                                       |
| `src/roles.ts`        | the role map (`org:admin`, `org:member`)                                                   |
| `src/token.ts`        | session token verification and its claims                                                  |
| `src/webhook.ts`, `src/webhook/payloads.ts` | svix verification and Clerk payloads → normalized events             |

## Rules

- No network in unit tests: the connector takes a `ClerkBackend`, and the tests drive it through a fake
  (`test/fixtures/backend.ts`). Token tests run the real `verifyToken` against a local RSA key (networkless,
  as with `CLERK_JWT_KEY`); webhook tests run the real `verifyWebhook` on deliveries signed with a test svix
  secret (`@mwc/testkit/webhooks`).
- Every failure is an `IdentityProviderError`; messages carry the operation, HTTP status and Clerk code, never
  a token, a key or a secret.
- The real development instance is reached only by `test/contract.test.ts`, and only with
  `CLERK_CONTRACT_TEST=1` (`pnpm --filter @mwc/identity-clerk contract`). Its helpers (the contract target and a
  small Frontend API client) live in `test/fixtures/`.
