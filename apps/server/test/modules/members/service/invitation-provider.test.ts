import { companies, type IdentityOutboxRow, identityOutbox } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { IdentityProviderError } from '@mwc/identity-core';
import { IDENTITY_METADATA } from '@mwc/shared/identity';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  invitationOutboxHandlers,
  inviteHandler,
  revokeInviteHandler,
} from '../../../../src/modules/members/service/invitation-provider.ts';
import { OUTBOX_MAX_ATTEMPTS, processOutboxRow } from '../../../../src/platform/jobs/outbox.ts';
import { auditOf, loseNextAnswer } from '../../../fixtures/companies/companies.ts';
import {
  DAY_MS,
  invitationRow,
  invitationsPath,
  invite,
  outboxRows,
  runOutbox,
  runRow,
  signUp,
} from '../../../fixtures/members/invitations.ts';
import { as, type MembersCompany, membersCompany } from '../../../fixtures/members/members.ts';
import { type AuthWorld, authWorld, WEB_ORIGIN } from '../../../fixtures/platform/auth.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

const orgOf = (company: MembersCompany) => company.orgId as string;
/** The fake's invitations that carry this invitation's id in their metadata. */
const copies = async (company: MembersCompany, id: string) =>
  (await w.fake.listInvitations(orgOf(company))).filter(
    (copy) => copy.metadata[IDENTITY_METADATA.invitationId] === id,
  );
const statuses = async (company: MembersCompany, id: string) =>
  (await copies(company, id)).map((copy) => copy.status);
const lastRow = async (company: MembersCompany, op: 'invite' | 'revoke_invite') =>
  (await outboxRows(w, company.companyId, op)).at(-1) as IdentityOutboxRow;
const resend = (company: MembersCompany, id: string) =>
  as(w, company.owner)('POST', `${invitationsPath(company)}/${id}/resend`);
const revoke = (company: MembersCompany, id: string) =>
  as(w, company.owner)('DELETE', `${invitationsPath(company)}/${id}`);

describe('invite', () => {
  it('sends the invitation with our metadata, its role, 14 days and the landing page, and stores its id', async () => {
    const company = await membersCompany(w);
    const sent = await invite(w, company, 'new@x.test', 'admin');
    const create = vi.spyOn(w.fake, 'createInvitation');
    expect(await runOutbox(w, company.companyId)).toEqual(['done']);
    expect(create).toHaveBeenCalledWith({
      orgExternalId: orgOf(company),
      email: 'new@x.test',
      role: 'admin',
      metadata: { mwc_invitation_id: sent.id, mwc_company_id: company.companyId },
      expiresInDays: 14,
      redirectUrl: `${WEB_ORIGIN}/accept-invitation`,
    });
    create.mockRestore();
    const [copy] = await copies(company, sent.id);
    expect(copy).toMatchObject({ status: 'pending', providerRole: 'org:admin', email: 'new@x.test' });
    expect(await invitationRow(w, sent.id)).toMatchObject({ externalInvitationId: copy?.externalId });
    const listed = await as(w, company.owner)('GET', invitationsPath(company));
    expect(listed.body).toMatchObject({ invitations: [{ id: sent.id, sent: true }] });
  });

  it('sends no second email when a retry follows an answer lost after the provider created it', async () => {
    const company = await membersCompany(w);
    const sent = await invite(w, company, 'lost@x.test');
    loseNextAnswer(w.fake, 'createInvitation');
    expect(await runOutbox(w, company.companyId)).toEqual(['retry']);
    expect(await lastRow(company, 'invite')).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: expect.stringContaining('unavailable'),
    });
    expect(await invitationRow(w, sent.id)).toMatchObject({ externalInvitationId: null });
    const create = vi.spyOn(w.fake, 'createInvitation');
    expect(await runRow(w, await lastRow(company, 'invite'))).toBe('done');
    expect(create).not.toHaveBeenCalled();
    create.mockRestore();
    const [copy, ...more] = await copies(company, sent.id);
    expect(more).toEqual([]);
    expect(await invitationRow(w, sent.id)).toMatchObject({ externalInvitationId: copy?.externalId });
  });

  it('tries again after a provider failure, and waits while the company has no organization yet', async () => {
    const company = await membersCompany(w);
    const sent = await invite(w, company, 'flaky@x.test');
    w.fake.failNext('createInvitation');
    expect(await runOutbox(w, company.companyId)).toEqual(['retry']);
    expect(await runRow(w, await lastRow(company, 'invite'))).toBe('done');
    expect(await statuses(company, sent.id)).toEqual(['pending']);

    const provisioning = await membersCompany(w, { provisioning: true });
    const waiting = await invite(w, provisioning, 'waiting@x.test');
    expect(await runOutbox(w, provisioning.companyId)).toEqual(['retry']);
    expect((await lastRow(provisioning, 'invite')).lastError).toMatch(
      /no organization at the identity provider yet/,
    );
    const org = await w.fake.createOrganization({ name: 'Late Co', metadata: {} });
    await rawDb(w.t.db)
      .update(companies)
      .set({ identityOrgId: org.externalId, status: 'active' })
      .where(eq(companies.id, provisioning.companyId));
    expect(await runRow(w, await lastRow(provisioning, 'invite'))).toBe('done');
    expect((await invitationRow(w, waiting.id))?.externalInvitationId).toEqual(expect.any(String));
  });

  it('sends nothing for an invitation revoked or expired before its call ran, or in a deleted company', async () => {
    const company = await membersCompany(w);
    const revoked = await invite(w, company, 'revoked-first@x.test');
    await revoke(company, revoked.id);
    const [inviteRow] = await outboxRows(w, company.companyId, 'invite');
    expect(await runRow(w, inviteRow as IdentityOutboxRow)).toBe('done');
    const overdue = await invite(w, company, 'overdue@x.test');
    w.clock.advance(14 * DAY_MS);
    expect(await runRow(w, await lastRow(company, 'invite'))).toBe('done');
    expect([...(await copies(company, revoked.id)), ...(await copies(company, overdue.id))]).toEqual([]);

    const deleted = await membersCompany(w);
    await invite(w, deleted, 'orphan@x.test');
    await rawDb(w.t.db)
      .update(companies)
      .set({ status: 'deleted' })
      .where(eq(companies.id, deleted.companyId));
    expect(await runRow(w, await lastRow(deleted, 'invite'))).toBe('done');
    expect(await w.fake.listInvitations(orgOf(deleted))).toEqual([]);
  });

  it('fails the row at once with the provider refusal as its reason, and the invitation, when the provider refuses it for good', async () => {
    const company = await membersCompany(w);
    const sent = await invite(w, company, 'sixth@x.test');
    const refusal =
      'clerk: createInvitation failed (422 organization_membership_quota_exceeded): ' +
      'You have reached your limit of 5 organization memberships, including outstanding invitations.';
    w.fake.failNext('createInvitation', new IdentityProviderError('invalid', refusal));
    expect(await runOutbox(w, company.companyId)).toEqual(['failed']);
    expect(await lastRow(company, 'invite')).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: `invalid: ${refusal}`,
    });
    expect(await invitationRow(w, sent.id)).toMatchObject({ status: 'failed', externalInvitationId: null });
    const audit = (await auditOf(w.t.db, company.companyId)).filter((row) => row.action === 'fail');
    expect(audit).toEqual([
      expect.objectContaining({
        actorKind: 'system',
        entityId: sent.id,
        oldValue: 'pending',
        newValue: 'failed',
      }),
    ]);
    // The email is free for another invitation.
    expect((await invite(w, company, 'sixth@x.test')).status).toBe('pending');
  });

  it("fails the invitation with the row's last allowed try, and needs a provider", async () => {
    const company = await membersCompany(w);
    const sent = await invite(w, company, 'last-try@x.test');
    const row = await lastRow(company, 'invite');
    await rawDb(w.t.db)
      .update(identityOutbox)
      .set({ attempts: OUTBOX_MAX_ATTEMPTS - 1 })
      .where(eq(identityOutbox.id, row.id));
    w.fake.failNext('listInvitations');
    expect(await runRow(w, await lastRow(company, 'invite'))).toBe('failed');
    expect(await invitationRow(w, sent.id)).toMatchObject({ status: 'failed' });

    const other = await invite(w, company, 'no-provider@x.test');
    const handler = inviteHandler({ db: w.t.db, identity: undefined, clock: w.clock });
    const jobs = { db: w.t.db, clock: w.clock };
    expect(await processOutboxRow(jobs, await lastRow(company, 'invite'), handler)).toBe('retry');
    expect(await invitationRow(w, other.id)).toMatchObject({ status: 'pending' });
  });
});

describe('invite: rows that name nothing, and failures with nothing left to fail', () => {
  it('does nothing for a row without an invitation, and sends without a landing page when the row has none', async () => {
    const company = await membersCompany(w);
    const sent = await invite(w, company, 'bare@x.test');
    const row = await lastRow(company, 'invite');
    const jobs = { db: w.t.db, clock: w.clock };
    const handler = inviteHandler({ db: w.t.db, identity: w.fake, clock: w.clock });
    expect(await processOutboxRow(jobs, { ...row, payload: {} }, handler)).toBe('done');
    expect(await copies(company, sent.id)).toEqual([]);
    const create = vi.spyOn(w.fake, 'createInvitation');
    expect(await processOutboxRow(jobs, { ...row, payload: { invitationId: sent.id } }, handler)).toBe(
      'done',
    );
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('redirectUrl');
    create.mockRestore();
  });

  it('fails the last try of a row whose invitation is revoked or whose company is deleted, changing nothing', async () => {
    const company = await membersCompany(w);
    const sent = await invite(w, company, 'gone-anyway@x.test');
    await revoke(company, sent.id);
    const handler = inviteHandler({ db: w.t.db, identity: undefined, clock: w.clock });
    const jobs = { db: w.t.db, clock: w.clock };
    const lastTry = (row: IdentityOutboxRow) => ({ ...row, attempts: OUTBOX_MAX_ATTEMPTS - 1 });
    const [inviteRow] = await outboxRows(w, company.companyId, 'invite');
    expect(await processOutboxRow(jobs, lastTry(inviteRow as IdentityOutboxRow), handler)).toBe('failed');
    expect(await invitationRow(w, sent.id)).toMatchObject({ status: 'revoked' });

    const deleted = await membersCompany(w);
    const orphan = await invite(w, deleted, 'orphan-last@x.test');
    await rawDb(w.t.db)
      .update(companies)
      .set({ status: 'deleted' })
      .where(eq(companies.id, deleted.companyId));
    expect(await processOutboxRow(jobs, lastTry(await lastRow(deleted, 'invite')), handler)).toBe('failed');
    expect(await invitationRow(w, orphan.id)).toMatchObject({ status: 'pending' });
  });
});

describe('invite after a resend', () => {
  it('revokes the copy it replaces and sends a new one that links back to the same invitation', async () => {
    const company = await membersCompany(w);
    const sent = await invite(w, company, 'resent@x.test', 'viewer');
    await runOutbox(w, company.companyId);
    const [first] = await copies(company, sent.id);
    expect((await resend(company, sent.id)).status).toBe(200);
    expect(await runOutbox(w, company.companyId)).toEqual(['done']);
    const after = await copies(company, sent.id);
    expect(after.map((copy) => [copy.externalId === first?.externalId, copy.status])).toEqual([
      [true, 'revoked'],
      [false, 'pending'],
    ]);
    expect(await invitationRow(w, sent.id)).toMatchObject({
      status: 'pending',
      externalInvitationId: after[1]?.externalId,
    });
  });

  it('adopts the new copy when the answer was lost, and sends one copy for two resends queued together', async () => {
    const company = await membersCompany(w);
    const sent = await invite(w, company, 'double@x.test');
    await runOutbox(w, company.companyId);
    await resend(company, sent.id);
    await resend(company, sent.id);
    loseNextAnswer(w.fake, 'createInvitation');
    expect(await runOutbox(w, company.companyId)).toEqual(['retry', 'done']);
    expect(await runOutbox(w, company.companyId)).toEqual(['done']);
    expect(await statuses(company, sent.id)).toEqual(['revoked', 'pending']);
    const [, current] = await copies(company, sent.id);
    expect(await invitationRow(w, sent.id)).toMatchObject({ externalInvitationId: current?.externalId });
  });

  it('sends nothing new when the person accepted the copy it replaces before it ran', async () => {
    const company = await membersCompany(w);
    const person = signUp(w);
    const sent = await invite(w, company, person.email);
    await runOutbox(w, company.companyId);
    const [first] = await copies(company, sent.id);
    await resend(company, sent.id);
    w.fake.accept(first?.externalId as string, person.subject);
    expect(await runOutbox(w, company.companyId)).toEqual(['done']);
    expect(await statuses(company, sent.id)).toEqual(['accepted']);
  });
});

describe('revoke_invite', () => {
  it('revokes the provider invitation, and every pending copy of it the provider has', async () => {
    const company = await membersCompany(w);
    const sent = await invite(w, company, 'bye@x.test');
    await runOutbox(w, company.companyId);
    await revoke(company, sent.id);
    expect(await runOutbox(w, company.companyId)).toEqual(['done']);
    expect(await statuses(company, sent.id)).toEqual(['revoked']);

    const lost = await invite(w, company, 'lost-then-revoked@x.test');
    loseNextAnswer(w.fake, 'createInvitation');
    expect(await runOutbox(w, company.companyId)).toEqual(['retry']);
    await revoke(company, lost.id);
    // The revoke runs first and finds the copy by its metadata; the invite then has nothing left to send.
    expect(await runRow(w, await lastRow(company, 'revoke_invite'))).toBe('done');
    expect(await runRow(w, await lastRow(company, 'invite'))).toBe('done');
    expect(await statuses(company, lost.id)).toEqual(['revoked']);
  });

  it('counts a copy accepted or gone meanwhile as done, and waits for the organization', async () => {
    const company = await membersCompany(w);
    const person = signUp(w);
    const sent = await invite(w, company, person.email);
    await runOutbox(w, company.companyId);
    await revoke(company, sent.id);
    w.fake.accept((await invitationRow(w, sent.id))?.externalInvitationId as string, person.subject);
    expect(await runOutbox(w, company.companyId)).toEqual(['done']);
    expect(await statuses(company, sent.id)).toEqual(['accepted']);
    w.fake.failNext('revokeInvitation', new IdentityProviderError('not_found', 'fake: gone'));
    const handler = revokeInviteHandler({ db: w.t.db, identity: w.fake, clock: w.clock });
    const done = { ...(await lastRow(company, 'revoke_invite')), status: 'pending' as const };
    expect(await processOutboxRow({ db: w.t.db, clock: w.clock }, done, handler)).toBe('done');

    const provisioning = await membersCompany(w, { provisioning: true });
    const early = await invite(w, provisioning, 'early@x.test');
    await revoke(provisioning, early.id);
    expect(await runRow(w, await lastRow(provisioning, 'revoke_invite'))).toBe('retry');
  });

  it('does nothing for an invitation that is not revoked, and rethrows other provider failures', async () => {
    const company = await membersCompany(w);
    const sent = await invite(w, company, 'keep@x.test');
    await runOutbox(w, company.companyId);
    const handlers = invitationOutboxHandlers({ db: w.t.db, identity: w.fake, clock: w.clock });
    const forged = {
      ...(await lastRow(company, 'invite')),
      status: 'pending' as const,
      op: 'revoke_invite' as const,
    };
    const jobs = { db: w.t.db, clock: w.clock };
    expect(await processOutboxRow(jobs, forged, handlers.revoke_invite as never)).toBe('done');
    expect(await statuses(company, sent.id)).toEqual(['pending']);
    await revoke(company, sent.id);
    w.fake.failNext('revokeInvitation');
    expect(await runRow(w, await lastRow(company, 'revoke_invite'))).toBe('retry');
    expect(await runRow(w, await lastRow(company, 'revoke_invite'))).toBe('done');
    expect(Object.keys(handlers).sort()).toEqual(['invite', 'revoke_invite']);
  });
});
