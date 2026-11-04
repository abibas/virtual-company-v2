import {
  type ExternalMembership,
  IDENTITY_METADATA,
  type NormalizedIdentityEvent,
} from '@mwc/shared/identity';
import type { IdentityStore, InvitationPatch, StoredInvitation } from '../store.ts';
import { change, diff, type ProjectionChange } from './changes.ts';

export interface Link {
  readonly invitation: StoredInvitation;
  /** Why this invitation cannot be claimed by this membership, or null when it can. */
  readonly refused: string | null;
}

/** The local invitation a membership came from: by `mwc_invitation_id`, else by the provider's invitation id. */
export async function findLink(
  membership: ExternalMembership,
  companyId: string,
  userId: string,
  store: IdentityStore,
): Promise<Link | undefined> {
  const metadataId = membership.metadata[IDENTITY_METADATA.invitationId];
  let invitation = typeof metadataId === 'string' ? await store.getInvitation(metadataId) : undefined;
  if (!invitation && membership.externalInvitationId !== undefined) {
    invitation = await store.getInvitationByExternalId(membership.externalInvitationId);
  }
  if (!invitation) return undefined;
  let refused: string | null = null;
  if (invitation.companyId !== companyId) refused = 'invitation_other_company';
  else if (
    invitation.status === 'revoked' ||
    invitation.status === 'expired' ||
    invitation.status === 'failed'
  ) {
    refused = `invitation_${invitation.status}`;
  } else if (invitation.acceptedByUserId !== null && invitation.acceptedByUserId !== userId) {
    refused = 'invitation_claimed';
  }
  return { invitation, refused };
}

/**
 * The person accepted the invitation: a fact, whatever order the events come in. The provider's id of the
 * invitation is learned here too when the local row does not know it yet (as `invitation.accepted` does),
 * so both orders end with it.
 */
export async function acceptInvitation(
  event: NormalizedIdentityEvent,
  invitation: StoredInvitation,
  userId: string,
  externalInvitationId: string | undefined,
  store: IdentityStore,
): Promise<ProjectionChange[]> {
  const patch: InvitationPatch = {
    ...(invitation.acceptedByUserId === null
      ? { status: 'accepted' as const, acceptedByUserId: userId }
      : {}),
    ...(invitation.externalInvitationId === null && externalInvitationId !== undefined
      ? { externalInvitationId }
      : {}),
  };
  if (Object.keys(patch).length === 0) return [];
  await store.updateInvitation(invitation.id, patch);
  return [
    change(event, 'invitation', invitation.status === 'pending' ? 'accepted' : 'updated', {
      id: invitation.id,
      companyId: invitation.companyId,
      fields: diff(invitation, { ...invitation, ...patch }, [
        'status',
        'acceptedByUserId',
        'externalInvitationId',
      ]),
    }),
  ];
}
