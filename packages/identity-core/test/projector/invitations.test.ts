import type { InvitationStatus, NormalizedIdentityEvent } from '@mwc/shared/identity';
import { describe, expect, it } from 'vitest';
import { project } from '../../src/projector.ts';
import type { Event } from '../fixtures/events.ts';
import { actions, first, must, variant } from '../fixtures/events.ts';
import { acmeWorld, applyAll, invitationMetadata } from '../fixtures/world.ts';

describe('invitation.accepted and invitation.revoked', () => {
  it('marks the invitation accepted by mwc_invitation_id, or by the provider id without metadata', async () => {
    const w = await acmeWorld();
    w.fake.createUser({ subject: 'u_bob', email: 'bob@x.test' });
    w.fake.createUser({ subject: 'u_hank', email: 'hank@x.test' });
    w.fake.accept(await w.invite('inv-bob', 'bob@x.test', 'member'), 'u_bob');
    w.fake.accept(await w.invite('inv-hank', 'hank@x.test', 'member', { metadata: false }), 'u_hank', {
      includeInvitationId: false,
    });
    const accepted = w.fake.drainEvents().filter((e) => e.type === 'invitation.accepted');
    expect(accepted.map((e) => Object.keys(e.data.metadata).length)).toEqual([2, 0]);
    expect(actions(await applyAll(accepted, w.store, w.ctx))).toEqual([
      'invitation:accepted',
      'invitation:accepted',
    ]);
    expect(await w.store.getInvitation('inv-hank')).toMatchObject({
      status: 'accepted',
      acceptedByUserId: null,
    });
  });

  it('marks a pending invitation revoked', async () => {
    const w = await acmeWorld();
    await w.fake.revokeInvitation(w.org.externalId, await w.invite('inv-gina', 'gina@x.test', 'member'));
    expect(actions(await w.apply())).toEqual(['invitation:revoked']);
    expect((await w.store.getInvitation('inv-gina'))?.status).toBe('revoked');
  });

  it('ignores an unknown invitation, one of another company and one our row no longer follows', async () => {
    const w = await acmeWorld();
    await w.fake.revokeInvitation(w.org.externalId, await w.invite('inv-gina', 'gina@x.test', 'member'));
    const [revoked] = w.fake.drainEvents() as Event<'invitation.revoked'>[];
    const event = must(revoked);
    const unknown = variant(event, { metadata: {}, externalId: 'orginv_unknown' });
    expect(actions(await project(unknown, w.store, w.ctx))).toEqual([
      'invitation:ignored:unknown_invitation',
    ]);
    const elsewhere = variant(event, { orgExternalId: 'org_other' });
    expect(actions(await project(elsewhere, w.store, w.ctx))).toEqual([
      'invitation:ignored:invitation_other_company',
    ]);
    // Sent again with the same metadata: revoking the first provider invitation leaves ours pending.
    const superseded = variant(event, { externalId: 'orginv_first_send' });
    expect(actions(await project(superseded, w.store, w.ctx))).toEqual([
      'invitation:ignored:other_provider_invitation',
    ]);
    expect((await w.store.getInvitation('inv-gina'))?.status).toBe('pending');
  });

  it.each<[InvitationStatus, 'invitation.accepted' | 'invitation.revoked', string]>([
    ['accepted', 'invitation.accepted', 'invitation:ignored:already_accepted'],
    ['accepted', 'invitation.revoked', 'invitation:ignored:invitation_accepted'],
    ['revoked', 'invitation.revoked', 'invitation:ignored:already_revoked'],
    ['revoked', 'invitation.accepted', 'invitation:refused:invitation_revoked'],
    ['expired', 'invitation.accepted', 'invitation:refused:invitation_expired'],
    ['expired', 'invitation.revoked', 'invitation:ignored:invitation_expired'],
    ['failed', 'invitation.accepted', 'invitation:refused:invitation_failed'],
  ])('keeps an invitation that is %s here on %s (%s)', async (status, type, expected) => {
    const w = await acmeWorld();
    const sent = await w.fake.createInvitation({
      orgExternalId: w.org.externalId,
      email: 'bob@x.test',
      role: 'member',
      metadata: invitationMetadata('inv-bob', w.company.id),
    });
    w.store.addInvitation({
      id: 'inv-bob',
      companyId: w.company.id,
      email: 'bob@x.test',
      role: 'member',
      status,
      externalInvitationId: sent.externalId,
    });
    const event = {
      provider: 'fake',
      externalEventId: 'evt_1',
      occurredAt: sent.updatedAt + 1,
      type,
      data: { ...sent, status: type === 'invitation.accepted' ? 'accepted' : 'revoked' },
    } as NormalizedIdentityEvent;
    expect(actions(await project(event, w.store, w.ctx))).toEqual([expected]);
    expect((await w.store.getInvitation('inv-bob'))?.status).toBe(status);
  });

  it('learns the provider id even when the invitation is no longer pending', async () => {
    const w = await acmeWorld();
    w.fake.createUser({ subject: 'u_ivan', email: 'ivan@x.test' });
    const sent = await w.invite('inv-ivan', 'ivan@x.test', 'member', { knownExternalId: false });
    w.fake.accept(sent, 'u_ivan', { includeInvitationId: false });
    const events = w.fake.drainEvents();
    const accepted = first(events, 'invitation.accepted');
    await applyAll(
      events.filter((e) => e !== accepted),
      w.store,
      w.ctx,
    );
    expect((await w.store.getInvitation('inv-ivan'))?.externalInvitationId).toBeNull();
    const changes = await project(accepted, w.store, w.ctx);
    expect(changes).toMatchObject([
      { action: 'updated', fields: [{ field: 'externalInvitationId', old: null, new: sent }] },
    ]);
    expect(actions(await project(accepted, w.store, w.ctx))).toEqual(['invitation:ignored:already_accepted']);

    // A locally revoked invitation learns it too, and the acceptance is still refused.
    w.store.addInvitation({
      id: 'inv-late',
      companyId: w.company.id,
      email: 'l@x.test',
      role: 'member',
      status: 'revoked',
    });
    const late = variant(accepted, {
      externalId: 'orginv_late',
      metadata: invitationMetadata('inv-late', w.company.id),
    });
    expect(actions(await project(late, w.store, w.ctx))).toEqual([
      'invitation:updated',
      'invitation:refused:invitation_revoked',
    ]);
    expect(await w.store.getInvitation('inv-late')).toMatchObject({
      status: 'revoked',
      externalInvitationId: 'orginv_late',
    });
  });
});
