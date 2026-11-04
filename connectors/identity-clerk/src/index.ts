// @mwc/identity-clerk: the Clerk identity connector (README.md, docs/clerk-setup.md). It implements
// @mwc/identity-core's IdentityProvider; the server wires it (S1.4), modules only see the port.
export {
  type ClerkBackend,
  type ClerkBackendApi,
  type ClerkInvitationData,
  type ClerkMembershipData,
  type ClerkOrganizationData,
  type ClerkUserData,
  type ClerkWebhookEnvelope,
  clerkBackend,
  type Page,
  type VerifyTokenFn,
  type VerifyWebhookFn,
} from './backend/client.ts';
export { DEFAULT_RETRY_AFTER_MS, toIdentityError } from './backend/errors.ts';
export { INVITATION_LIMIT, type RateBucket, RateGate } from './backend/rate-limit.ts';
export {
  type ClerkConfig,
  ClerkConfigError,
  clerkConfigFromEnv,
  frontendApiFromPublishableKey,
} from './config.ts';
export { clerkIdentityProvider, createClerkIdentityProvider } from './create.ts';
export {
  ClerkIdentityProvider,
  type ClerkIdentityProviderOptions,
  DEFAULT_INVITATION_DAYS,
  PAGE_SIZE,
} from './provider.ts';
export { CLERK_ADMIN_ROLE, CLERK_MEMBER_ROLE, CLERK_ROLES, type ClerkRoleMap } from './roles.ts';
export { CLOCK_SKEW_MS, identityFromClaims } from './token.ts';
export { parseClerkWebhook } from './webhook.ts';
