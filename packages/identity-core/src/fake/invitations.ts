import type { ExternalInvitation, ExternalInvitationStatus } from '@mwc/shared/identity';
import { IdentityProviderError } from '../errors.ts';
import type { CreateInvitationInput } from '../provider.ts';
import type { FakeWorld } from './world.ts';

/** The fake provider's invitations, as Clerk handles them; `FakeIdentityProvider` delegates here. */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A pending invitation with the given provider role, valid for `expiresInDays` (30 by default). Refuses a
 * second pending invitation for the same email, and an email that is already a member.
 */
export function createFakeInvitation(
  world: FakeWorld,
  input: CreateInvitationInput,
  providerRole: string,
): ExternalInvitation {
  world.org(input.orgExternalId);
  const email = input.email.toLowerCase();
  const invitations = [...world.invitations.values()].filter((i) => i.orgExternalId === input.orgExternalId);
  if (invitations.some((i) => i.email === email && i.status === 'pending')) {
    throw new IdentityProviderError('conflict', `fake: ${email} already has a pending invitation`);
  }
  for (const subject of world.members.get(input.orgExternalId)?.keys() ?? []) {
    if (world.users.get(subject)?.primaryEmail === email)
      throw new IdentityProviderError('conflict', `fake: ${email} is a member`);
  }
  const now = world.tick();
  const invitation: ExternalInvitation = {
    externalId: world.id('orginv'),
    orgExternalId: input.orgExternalId,
    email,
    providerRole,
    status: 'pending',
    metadata: { ...input.metadata },
    expiresAt: now + (input.expiresInDays ?? 30) * DAY_MS,
    updatedAt: now,
  };
  world.invitations.set(invitation.externalId, invitation);
  return invitation;
}

/** Revokes a pending invitation (emitted); a revoked one is returned as it is, any other status refused. */
export function revokeFakeInvitation(
  world: FakeWorld,
  orgExternalId: string,
  invitationExternalId: string,
): ExternalInvitation {
  const invitation = world.invitations.get(invitationExternalId);
  if (!invitation || invitation.orgExternalId !== orgExternalId) {
    throw new IdentityProviderError('not_found', `fake: no invitation ${invitationExternalId}`);
  }
  if (invitation.status === 'revoked') return invitation;
  if (invitation.status !== 'pending')
    throw new IdentityProviderError('conflict', `fake: invitation is ${invitation.status}`);
  const revoked: ExternalInvitation = { ...invitation, status: 'revoked', updatedAt: world.tick() };
  world.invitations.set(invitationExternalId, revoked);
  world.emit({ type: 'invitation.revoked', data: revoked }, revoked.updatedAt);
  return revoked;
}

/** The organization's invitations, optionally of one status. */
export function listFakeInvitations(
  world: FakeWorld,
  orgExternalId: string,
  status?: ExternalInvitationStatus,
): ExternalInvitation[] {
  world.org(orgExternalId);
  return [...world.invitations.values()].filter(
    (i) => i.orgExternalId === orgExternalId && (status === undefined || i.status === status),
  );
}
