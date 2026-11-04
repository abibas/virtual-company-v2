import { IDENTITY_METADATA } from '@mwc/shared/identity';
import { expect } from 'vitest';
import { CONTRACT_WEB_ORIGIN, type ContractCase, collect, need, providerError } from './state.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

export const createsInvitations: ContractCase = {
  name: 'createInvitation sends one with our metadata, the mapped role and a 14-day expiry',
  async run(state) {
    const { target, provider } = state;
    const { externalId } = need(state.org, 'organization');
    const metadata = {
      [IDENTITY_METADATA.invitationId]: `${target.runId}-invitation`,
      [IDENTITY_METADATA.companyId]: need(state.companyId, 'company'),
    };
    state.invitation = await provider.createInvitation({
      orgExternalId: externalId,
      email: target.email('invitee'),
      role: 'member',
      metadata,
      redirectUrl: `${CONTRACT_WEB_ORIGIN}/accept-invitation`,
      expiresInDays: 14,
    });
    expect(state.invitation).toMatchObject({
      orgExternalId: externalId,
      email: target.email('invitee').toLowerCase(),
      providerRole: provider.roles.toProvider('member'),
      status: 'pending',
      metadata,
    });
    const now = Date.now();
    expect(state.invitation.expiresAt).toBeGreaterThan(now + 13 * DAY_MS);
    expect(state.invitation.expiresAt).toBeLessThan(now + 15 * DAY_MS);
  },
};

export const refusesDuplicateInvitations: ContractCase = {
  name: 'createInvitation refuses a second pending invitation for the same email as conflict',
  async run({ target, provider, invitation }) {
    const { orgExternalId } = need(invitation, 'invitation');
    const error = await providerError(() =>
      provider.createInvitation({
        orgExternalId,
        email: target.email('invitee'),
        role: 'member',
        metadata: {},
      }),
    );
    expect(error.code).toBe('conflict');
  },
};

export const listsInvitations: ContractCase = {
  name: 'listInvitations lists all of them, or those of one status',
  async run({ provider, invitation }) {
    const { orgExternalId, externalId } = need(invitation, 'invitation');
    const ids = async (status?: 'pending' | 'accepted') =>
      (await provider.listInvitations(orgExternalId, status)).map((i) => i.externalId);
    expect(await ids()).toContain(externalId);
    expect(await ids('pending')).toContain(externalId);
    expect(await ids('accepted')).not.toContain(externalId);
  },
};

export const revokesInvitations: ContractCase = {
  name: 'revokeInvitation revokes a pending one, again returns it, and refuses an unknown one as not_found',
  async run({ target, provider, org }) {
    const { externalId } = need(org, 'organization');
    const second = await provider.createInvitation({
      orgExternalId: externalId,
      email: target.email('revoked'),
      role: 'admin',
      metadata: { [IDENTITY_METADATA.invitationId]: `${target.runId}-revoked` },
    });
    expect(second.providerRole).toBe(provider.roles.toProvider('admin'));
    expect((await provider.revokeInvitation(externalId, second.externalId)).status).toBe('revoked');
    expect((await provider.revokeInvitation(externalId, second.externalId)).status).toBe('revoked');
    const revoked = await provider.listInvitations(externalId, 'revoked');
    expect(revoked.map((i) => i.externalId)).toContain(second.externalId);
    const error = await providerError(() => provider.revokeInvitation(externalId, target.missing.invitation));
    expect(error.code).toBe('not_found');
  },
};

export const acceptsInvitations: ContractCase = {
  name: "an accepted invitation's private metadata (mwc_invitation_id) reaches the membership",
  async run(state, skip) {
    const { target, provider } = state;
    const invitation = need(state.invitation, 'invitation');
    const accepted = await target.acceptInvitation(invitation);
    if ('unverified' in accepted) return skip(`unverified: ${accepted.unverified}`);
    state.member = accepted.subject;
    const members = await collect(provider.listOrganizationMembers(invitation.orgExternalId));
    const membership = members.find((m) => m.subject === accepted.subject);
    expect(membership?.providerRole).toBe(provider.roles.toProvider('member'));
    expect(membership?.metadata).toMatchObject(invitation.metadata);
    const after = await provider.listInvitations(invitation.orgExternalId, 'accepted');
    expect(after.find((i) => i.externalId === invitation.externalId)?.status).toBe('accepted');
    const error = await providerError(() =>
      provider.revokeInvitation(invitation.orgExternalId, invitation.externalId),
    );
    expect(error.code).toBe('conflict');
  },
};
