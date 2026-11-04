import { type ClerkClient, createClerkClient, verifyToken } from '@clerk/backend';
import { verifyWebhook } from '@clerk/backend/webhooks';

/**
 * The part of `@clerk/backend` the connector uses, as a port: the real SDK satisfies it (`clerkBackend`),
 * and the unit tests drive the connector through a fake with no network. Resource shapes are the SDK
 * objects' fields the connector reads; SDK class instances fit them structurally.
 */

export interface ClerkEmailAddressData {
  readonly id: string;
  readonly emailAddress: string;
}

export interface ClerkUserData {
  readonly id: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly username: string | null;
  readonly imageUrl: string;
  readonly hasImage: boolean;
  readonly primaryEmailAddressId: string | null;
  readonly emailAddresses: readonly ClerkEmailAddressData[];
  readonly updatedAt: number;
}

export interface ClerkOrganizationData {
  readonly id: string;
  readonly name: string;
  readonly slug: string | null;
  readonly privateMetadata: Record<string, unknown> | null;
  readonly updatedAt: number;
}

export interface ClerkMembershipData {
  readonly id: string;
  readonly role: string;
  readonly privateMetadata: Record<string, unknown> | null;
  readonly updatedAt: number;
  readonly organization: ClerkOrganizationData;
  readonly publicUserData?: { readonly userId: string } | null | undefined;
}

export interface ClerkInvitationData {
  readonly id: string;
  readonly emailAddress: string;
  readonly role: string;
  readonly organizationId: string;
  readonly status?: 'pending' | 'accepted' | 'revoked' | 'expired' | undefined;
  readonly privateMetadata: Record<string, unknown> | null;
  readonly expiresAt: number;
  readonly updatedAt: number;
  readonly url: string | null;
}

export interface Page<T> {
  readonly data: readonly T[];
  readonly totalCount: number;
}

type Orgs = ClerkClient['organizations'];
type ParamsOf<F extends (...args: never[]) => unknown> = Parameters<F>[0];

export interface ClerkBackendApi {
  readonly users: {
    getUser(userId: string): Promise<ClerkUserData>;
    getOrganizationMembershipList(
      params: ParamsOf<ClerkClient['users']['getOrganizationMembershipList']>,
    ): Promise<Page<ClerkMembershipData>>;
  };
  readonly organizations: {
    createOrganization(params: ParamsOf<Orgs['createOrganization']>): Promise<ClerkOrganizationData>;
    getOrganizationList(params: ParamsOf<Orgs['getOrganizationList']>): Promise<Page<ClerkOrganizationData>>;
    deleteOrganization(organizationId: string): Promise<unknown>;
    getOrganizationMembershipList(
      params: ParamsOf<Orgs['getOrganizationMembershipList']>,
    ): Promise<Page<ClerkMembershipData>>;
    updateOrganizationMembership(
      params: ParamsOf<Orgs['updateOrganizationMembership']>,
    ): Promise<ClerkMembershipData>;
    deleteOrganizationMembership(params: ParamsOf<Orgs['deleteOrganizationMembership']>): Promise<unknown>;
    createOrganizationInvitation(
      params: ParamsOf<Orgs['createOrganizationInvitation']>,
    ): Promise<ClerkInvitationData>;
    getOrganizationInvitation(
      params: ParamsOf<Orgs['getOrganizationInvitation']>,
    ): Promise<ClerkInvitationData>;
    revokeOrganizationInvitation(
      params: ParamsOf<Orgs['revokeOrganizationInvitation']>,
    ): Promise<ClerkInvitationData>;
    getOrganizationInvitationList(
      params: ParamsOf<Orgs['getOrganizationInvitationList']>,
    ): Promise<Page<ClerkInvitationData>>;
  };
}

/** `verifyToken` of `@clerk/backend`: resolves the verified claims, throws `TokenVerificationError`. */
export type VerifyTokenFn = (token: string, options: Parameters<typeof verifyToken>[1]) => Promise<object>;

/** A verified webhook event: the envelope fields the connector reads. */
export interface ClerkWebhookEnvelope {
  readonly type: string;
  readonly data: unknown;
  readonly timestamp?: number;
}

/** `verifyWebhook` of `@clerk/backend/webhooks` (svix / Standard Webhooks signatures). */
export type VerifyWebhookFn = (
  request: Request,
  options: { signingSecret: string },
) => Promise<ClerkWebhookEnvelope>;

export interface ClerkBackend {
  readonly api: ClerkBackendApi;
  readonly verifyToken: VerifyTokenFn;
  readonly verifyWebhook: VerifyWebhookFn;
}

/** The real SDK behind the port: a Backend API client for the secret key, and Clerk's own verifiers. */
export function clerkBackend(secretKey: string): ClerkBackend {
  const client = createClerkClient({ secretKey, telemetry: { disabled: true } });
  return { api: client, verifyToken, verifyWebhook };
}
