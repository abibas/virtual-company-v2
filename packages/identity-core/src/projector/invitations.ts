import type { ExternalInvitation } from '@mwc/shared/identity';
import { IDENTITY_METADATA } from '@mwc/shared/identity';
import type { IdentityStore, InvitationPatch } from '../store.ts';
import { change, diff, type Event, type ProjectionChange } from './changes.ts';

export async function projectInvitation(
  event: Event<'invitation.accepted' | 'invitation.revoked'>,
  store: IdentityStore,
): Promise<ProjectionChange[]> {
  const data: ExternalInvitation = event.data;
  const metadataId = data.metadata[IDENTITY_METADATA.invitationId];
  const local =
    (typeof metadataId === 'string' ? await store.getInvitation(metadataId) : undefined) ??
    (await store.getInvitationByExternalId(data.externalId));
  if (!local) return [change(event, 'invitation', 'ignored', { reason: 'unknown_invitation' })];
  const on = { id: local.id, companyId: local.companyId };
  const company = await store.getCompanyByOrgExternalId(data.orgExternalId);
  if (company?.id !== local.companyId) {
    return [change(event, 'invitation', 'ignored', { ...on, reason: 'invitation_other_company' })];
  }
  if (local.externalInvitationId !== null && local.externalInvitationId !== data.externalId) {
    // About a provider invitation this row no longer follows (it was sent again with the same metadata):
    // revoking the old one must not revoke ours.
    return [change(event, 'invitation', 'ignored', { ...on, reason: 'other_provider_invitation' })];
  }
  const accepted = event.type === 'invitation.accepted';
  const target: 'accepted' | 'revoked' = accepted ? 'accepted' : 'revoked';
  if (local.status === 'pending') {
    const patch: InvitationPatch = {
      status: target,
      ...(local.externalInvitationId === null ? { externalInvitationId: data.externalId } : {}),
    };
    await store.updateInvitation(local.id, patch);
    return [
      change(event, 'invitation', target, {
        ...on,
        fields: diff(local, { ...local, ...patch }, ['status', 'externalInvitationId']),
      }),
    ];
  }
  // Local decisions win: a revoked or expired invitation stays so even when the provider accepted it
  // (S1.7 then removes the membership there), and an accepted one is not revoked.
  const terminal = local.status === 'revoked' || local.status === 'expired' || local.status === 'failed';
  const reason = local.status === target ? `already_${target}` : `invitation_${local.status}`;
  const note = change(event, 'invitation', accepted && terminal ? 'refused' : 'ignored', { ...on, reason });
  if (local.externalInvitationId !== null) return [note];
  // The provider id is still learned (the membership may have accepted it first), so every order ends with it.
  await store.updateInvitation(local.id, { externalInvitationId: data.externalId });
  const learned = change(event, 'invitation', 'updated', {
    ...on,
    fields: [{ field: 'externalInvitationId', old: null, new: data.externalId }],
  });
  return note.action === 'refused' ? [learned, note] : [learned];
}
