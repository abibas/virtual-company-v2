// @mwc/identity-core: the provider-agnostic identity model (README.md). Test doubles are separate
// imports: @mwc/identity-core/fake (FakeIdentityProvider) and @mwc/identity-core/memory-store.
export {
  ExternalInvitation,
  ExternalInvitationStatus,
  ExternalMembership,
  ExternalOrg,
  ExternalUser,
  IDENTITY_EVENT_TYPES,
  IDENTITY_METADATA,
  type IdentityEventType,
  IdentityMetadata,
  InvitationStatus,
  MembershipRole,
  MembershipStatus,
  NormalizedIdentityEvent,
  VerifiedIdentity,
} from '@mwc/shared/identity';
export {
  IDENTITY_PROVIDER_ERROR_CODES,
  IdentityProviderError,
  type IdentityProviderErrorCode,
  type IdentityProviderErrorOptions,
  isIdentityProviderError,
} from './errors.ts';
export {
  effectiveRole,
  type FieldChange,
  type ProjectionAction,
  type ProjectionChange,
  type ProjectionContext,
  project,
  projectionContext,
  replayDeferred,
} from './projector.ts';
export type {
  CreateInvitationInput,
  CreateOrganizationInput,
  IdentityProvider,
  ProviderCapabilities,
  ProviderRoleMap,
  UserOrganization,
  VerifyTokenContext,
  WebhookRequest,
} from './provider.ts';
export {
  type ReconcileOptions,
  type ReconcileSummary,
  reconcileOrganization,
  reconcileUser,
} from './reconcile.ts';
export {
  type IdentityMark,
  type IdentityStore,
  type InvitationPatch,
  identityKeys,
  type NewStoredMembership,
  type NewStoredUser,
  type StoredCompany,
  type StoredInvitation,
  type StoredMembership,
  type StoredUser,
} from './store.ts';
