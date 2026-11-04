import { IdentityProviderError, type WebhookRequest } from '@mwc/identity-core';
import { type IdentityInboxEvent, IgnoredIdentityEvent, NormalizedIdentityEvent } from '@mwc/shared/identity';
import type { z } from 'zod';
import type { ClerkWebhookEnvelope, VerifyWebhookFn } from './backend/client.ts';
import {
  DeletedPayload,
  InvitationPayload,
  MembershipPayload,
  OrganizationPayload,
  UserPayload,
} from './webhook/payloads.ts';

/** Where Clerk's webhook endpoint will point (S1.8); only used to build the Request the verifier reads. */
const ENDPOINT = 'http://localhost/api/webhooks/clerk';

type Body = Pick<NormalizedIdentityEvent, 'type' | 'data'>;

function parse<T>(schema: z.ZodType<T>, data: unknown, type: string): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '(data)'}: ${issue.message}`,
    );
    throw new IdentityProviderError('invalid', `clerk: bad ${type} payload: ${issues.join('; ')}`);
  }
  return parsed.data;
}

/** The normalized type and data of a Clerk event, or null for an event type this product does not use. */
export function bodyOf(type: string, data: unknown): Body | null {
  switch (type) {
    case 'user.created':
    case 'user.updated':
      return { type: 'user.upserted', data: parse(UserPayload, data, type) };
    case 'user.deleted':
      return { type: 'user.deleted', data: { subject: parse(DeletedPayload, data, type).id } };
    case 'organization.created':
    case 'organization.updated':
      return { type: 'org.upserted', data: parse(OrganizationPayload, data, type) };
    case 'organization.deleted':
      return { type: 'org.deleted', data: { externalId: parse(DeletedPayload, data, type).id } };
    case 'organizationMembership.created':
    case 'organizationMembership.updated':
      return { type: 'membership.upserted', data: parse(MembershipPayload, data, type) };
    case 'organizationMembership.deleted': {
      const { orgExternalId, subject, externalMembershipId } = parse(MembershipPayload, data, type);
      return { type: 'membership.deleted', data: { orgExternalId, subject, externalMembershipId } };
    }
    case 'organizationInvitation.accepted':
      return { type: 'invitation.accepted', data: parse(InvitationPayload, data, type) };
    case 'organizationInvitation.revoked':
      return { type: 'invitation.revoked', data: parse(InvitationPayload, data, type) };
    default:
      return null;
  }
}

function header(request: WebhookRequest, name: string): string | undefined {
  return Object.entries(request.headers).find(([key]) => key.toLowerCase() === name)?.[1];
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

async function verified(
  verify: VerifyWebhookFn,
  signingSecret: string,
  request: WebhookRequest,
): Promise<ClerkWebhookEnvelope> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers))
    if (value !== undefined) headers.set(name, value);
  try {
    return await verify(new Request(ENDPOINT, { method: 'POST', headers, body: request.rawBody }), {
      signingSecret,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The verifier parses the body only after the signature matched: a JSON error means a signed bad body.
    if (/JSON/i.test(message) && !isJson(request.rawBody)) {
      throw new IdentityProviderError('invalid', 'clerk: signed webhook body is not JSON', { cause: error });
    }
    throw new IdentityProviderError('unauthorized', 'clerk: webhook signature does not verify', {
      cause: error,
    });
  }
}

/**
 * Verifies a Clerk (svix) delivery with `@clerk/backend`'s `verifyWebhook` (signature over id, timestamp
 * and body; timestamps more than 5 minutes off are refused), then normalizes it. The svix id is the
 * event id (the caller dedupes on it), the envelope's `timestamp` the event time, and each object's
 * `updated_at` its ordering guard. A type this product does not use (`session.created`,
 * `organizationInvitation.created`, ...) resolves as an `ignored` event with Clerk's type; an envelope with no
 * type at all as null.
 */
export async function parseClerkWebhook(
  verify: VerifyWebhookFn,
  signingSecret: string | undefined,
  request: WebhookRequest,
): Promise<IdentityInboxEvent | null> {
  if (!signingSecret) {
    throw new IdentityProviderError('unavailable', 'clerk: CLERK_WEBHOOK_SIGNING_SECRET is not set');
  }
  const envelope = await verified(verify, signingSecret, request);
  const sentAt = Number(header(request, 'svix-timestamp')) * 1000;
  const base = {
    provider: 'clerk',
    externalEventId: header(request, 'svix-id'),
    occurredAt: typeof envelope.timestamp === 'number' ? envelope.timestamp : sentAt,
  };
  const body = bodyOf(envelope.type, envelope.data);
  if (body === null) return ignoredOf(base, envelope.type);
  const event = NormalizedIdentityEvent.safeParse({ ...body, ...base });
  if (!event.success) throw new IdentityProviderError('invalid', `clerk: bad ${envelope.type} event`);
  return event.data;
}

/** A verified delivery of a type this product does not use, or null when the envelope names no type. */
function ignoredOf(base: Record<string, unknown>, type: unknown): IdentityInboxEvent | null {
  if (typeof type !== 'string' || type === '') return null;
  const event = IgnoredIdentityEvent.safeParse({ ...base, type: 'ignored', data: { providerType: type } });
  if (!event.success) throw new IdentityProviderError('invalid', `clerk: bad ${type} event`);
  return event.data;
}
