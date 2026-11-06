import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { InvitationView } from '../../../../src/modules/members/schemas.ts';
import { auditFields, auditOf, call } from '../../../fixtures/companies/companies.ts';
import {
  DAY_MS,
  invitationRow,
  invitationsPath,
  invite,
  outboxRows,
  runOutbox,
} from '../../../fixtures/members/invitations.ts';
import { addMember, as, type MembersCompany, membersCompany } from '../../../fixtures/members/members.ts';
import { type AuthWorld, authWorld, WEB_ORIGIN } from '../../../fixtures/platform/auth.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

const inDays = (days: number) => new Date(w.clock().getTime() + days * DAY_MS);
const oneOf = (company: MembersCompany, id: string) => `${invitationsPath(company)}/${id}`;
const invitationAudit = async (companyId: string) =>
  auditFields(await auditOf(w.t.db, companyId)).filter((row) => row.entityType === 'invitation');

describe('POST /api/companies/:companyId/invitations', () => {
  it('invites an email with a role: the row, its audit rows and the outbox invite call', async () => {
    const company = await membersCompany(w);
    const res = await as(w, company.owner, 'req-invite')('POST', invitationsPath(company), {
      email: 'Bob@Example.TEST',
      role: 'member',
    });
    expect(res.status).toBe(201);
    const view = res.body as InvitationView;
    const row = await invitationRow(w, view.id);
    expect(view).toEqual({
      id: row?.id,
      email: 'bob@example.test',
      role: 'member',
      status: 'pending',
      expiresAt: inDays(14).toISOString(),
      sent: false,
      invitedByPrincipalId: company.owner.principalId,
      acceptedByUserId: null,
      createdAt: row?.createdAt.toISOString(),
    });
    expect(row).toMatchObject({ emailNormalized: 'bob@example.test', externalInvitationId: null });
    expect(await outboxRows(w, company.companyId, 'invite')).toEqual([
      expect.objectContaining({
        status: 'pending',
        idempotencyKey: `invite:${view.id}`,
        payload: { invitationId: view.id, redirectUrl: `${WEB_ORIGIN}/accept-invitation` },
      }),
    ]);
    const who = { actorKind: 'user', actorPrincipalId: company.owner.principalId, requestId: 'req-invite' };
    const on = {
      companyId: company.companyId,
      entityType: 'invitation',
      entityId: view.id,
      action: 'create',
    };
    expect(await invitationAudit(company.companyId)).toEqual([
      { ...who, ...on, field: 'email', oldValue: null, newValue: 'bob@example.test' },
      { ...who, ...on, field: 'expiresAt', oldValue: null, newValue: inDays(14).toISOString() },
      { ...who, ...on, field: 'role', oldValue: null, newValue: 'member' },
      { ...who, ...on, field: 'status', oldValue: null, newValue: 'pending' },
    ]);
  });

  it('lets an owner invite with any role and an admin with any role but owner', async () => {
    const company = await membersCompany(w);
    const admin = await addMember(w, company, 'admin');
    for (const role of ['owner', 'admin', 'member', 'viewer'] as const) {
      expect((await invite(w, company, `owner-gives-${role}@x.test`, role)).role).toBe(role);
    }
    for (const role of ['admin', 'member', 'viewer'] as const) {
      expect((await invite(w, company, `admin-gives-${role}@x.test`, role, admin)).role).toBe(role);
    }
    expect(
      await as(w, admin)('POST', invitationsPath(company), { email: 'owner@x.test', role: 'owner' }),
    ).toMatchObject({
      status: 403,
      body: { error: { code: 'forbidden', message: 'Only an owner may make someone an owner' } },
    });
  });

  it('is a 401 without a credential, a 403 below admin and a 404 for an outsider or an unknown company', async () => {
    const company = await membersCompany(w);
    const body = { email: 'x@x.test', role: 'member' };
    expect(await call(w, undefined)('POST', invitationsPath(company), body)).toMatchObject({
      status: 401,
      body: { error: { code: 'unauthenticated' } },
    });
    for (const role of ['member', 'viewer'] as const) {
      const someone = await addMember(w, company, role);
      expect(await as(w, someone)('POST', invitationsPath(company), body)).toMatchObject({
        status: 403,
        body: { error: { code: 'forbidden' } },
      });
    }
    const other = await membersCompany(w);
    expect((await as(w, other.owner)('POST', invitationsPath(company), body)).status).toBe(404);
    const unknown = '/api/companies/019a4f0c-0000-7000-8000-000000000000/invitations';
    expect((await as(w, company.owner)('POST', unknown, body)).status).toBe(404);
    expect(await outboxRows(w, company.companyId, 'invite')).toEqual([]);
  });

  it('refuses a malformed email, an unknown role and a missing body with a 400', async () => {
    const company = await membersCompany(w);
    for (const body of [{ email: 'not-an-email', role: 'member' }, { email: 'a@b.test', role: 'boss' }, {}]) {
      expect(await as(w, company.owner)('POST', invitationsPath(company), body)).toMatchObject({
        status: 400,
        body: { error: { code: 'invalid_request' } },
      });
    }
    expect(await as(w, company.owner)('POST', invitationsPath(company))).toMatchObject({ status: 400 });
  });

  it("refuses a member's email (409 already_member) and an email with a pending invitation (409)", async () => {
    const company = await membersCompany(w);
    expect(
      await as(w, company.owner)('POST', invitationsPath(company), {
        email: `${company.owner.subject.toUpperCase()}@OWNERS.TEST`,
        role: 'admin',
      }),
    ).toMatchObject({ status: 409, body: { error: { code: 'already_member' } } });
    await invite(w, company, 'twice@x.test');
    expect(
      await as(w, company.owner)('POST', invitationsPath(company), {
        email: 'Twice@X.test',
        role: 'viewer',
      }),
    ).toMatchObject({ status: 409, body: { error: { code: 'invitation_pending' } } });
    expect(await outboxRows(w, company.companyId, 'invite')).toHaveLength(1);
  });
});

describe('GET /api/companies/:companyId/invitations', () => {
  it('lists the pending invitations newest first, or those of another status as of now, or all', async () => {
    const company = await membersCompany(w);
    const first = await invite(w, company, 'first@x.test');
    const revoked = await invite(w, company, 'revoked@x.test');
    expect((await as(w, company.owner)('DELETE', oneOf(company, revoked.id))).status).toBe(204);
    w.clock.advance(DAY_MS);
    const second = await invite(w, company, 'second@x.test', 'viewer');
    const list = async (query = '') => {
      const res = await as(w, company.owner)('GET', `${invitationsPath(company)}${query}`);
      expect(res.status).toBe(200);
      return (res.body as { invitations: InvitationView[] }).invitations;
    };
    expect((await list()).map((i) => i.id)).toEqual([second.id, first.id]);
    expect(await list('?status=pending')).toEqual(await list());
    expect((await list('?status=revoked')).map((i) => [i.id, i.status])).toEqual([[revoked.id, 'revoked']]);
    expect((await list('?status=all')).map((i) => i.id)).toEqual([second.id, revoked.id, first.id]);
    expect(await list('?status=expired')).toEqual([]);
    // The first one passes its expiry: it shows as expired from then on, without anything stored.
    w.clock.advance(13 * DAY_MS);
    expect((await list()).map((i) => i.id)).toEqual([second.id]);
    expect(await list('?status=expired')).toEqual([{ ...first, status: 'expired' }]);
    expect((await invitationRow(w, first.id))?.status).toBe('pending');
  });

  it('is a 401 without a credential, a 403 below admin, a 404 for an outsider and a 400 for an unknown status', async () => {
    const company = await membersCompany(w);
    expect((await call(w, undefined)('GET', invitationsPath(company))).status).toBe(401);
    const member = await addMember(w, company, 'member');
    expect((await as(w, member)('GET', invitationsPath(company))).status).toBe(403);
    const other = await membersCompany(w);
    expect((await as(w, other.owner)('GET', invitationsPath(company))).status).toBe(404);
    expect(await as(w, company.owner)('GET', `${invitationsPath(company)}?status=lost`)).toMatchObject({
      status: 400,
      body: { error: { code: 'invalid_request' } },
    });
  });
});

describe('POST /api/companies/:companyId/invitations/:invitationId/resend', () => {
  it('extends a pending invitation by 14 days from now and queues a new invite that replaces the sent one', async () => {
    const company = await membersCompany(w);
    const sent = await invite(w, company, 'again@x.test', 'admin');
    await runOutbox(w, company.companyId);
    const external = (await invitationRow(w, sent.id))?.externalInvitationId;
    expect(external).toEqual(expect.any(String));
    w.clock.advance(3 * DAY_MS);
    const res = await as(w, company.owner, 'req-resend')('POST', `${oneOf(company, sent.id)}/resend`);
    expect(res).toMatchObject({
      status: 200,
      body: { id: sent.id, status: 'pending', sent: false, expiresAt: inDays(14).toISOString() },
    });
    const [, resend] = await outboxRows(w, company.companyId, 'invite');
    expect(resend).toMatchObject({
      status: 'pending',
      idempotencyKey: expect.stringMatching(new RegExp(`^invite:${sent.id}:`)),
      payload: { invitationId: sent.id, replaces: external, redirectUrl: `${WEB_ORIGIN}/accept-invitation` },
    });
    expect((await invitationAudit(company.companyId)).filter((row) => row.action === 'resend')).toEqual([
      expect.objectContaining({
        actorPrincipalId: company.owner.principalId,
        requestId: 'req-resend',
        field: 'expiresAt',
        oldValue: sent.expiresAt,
        newValue: inDays(14).toISOString(),
      }),
    ]);
  });

  it('is a 409 for an invitation that is not pending (revoked, or past its expiry)', async () => {
    const company = await membersCompany(w);
    const revoked = await invite(w, company, 'gone@x.test');
    await as(w, company.owner)('DELETE', oneOf(company, revoked.id));
    const overdue = await invite(w, company, 'late@x.test');
    w.clock.advance(14 * DAY_MS);
    for (const id of [revoked.id, overdue.id]) {
      expect(await as(w, company.owner)('POST', `${oneOf(company, id)}/resend`)).toMatchObject({
        status: 409,
        body: { error: { code: 'invitation_not_pending' } },
      });
    }
  });

  it("is a 401, a 403 below admin or for an admin and an owner's invitation, and a 404 for an unknown one", async () => {
    const company = await membersCompany(w);
    const forOwner = await invite(w, company, 'future-owner@x.test', 'owner');
    const path = `${oneOf(company, forOwner.id)}/resend`;
    expect((await call(w, undefined)('POST', path)).status).toBe(401);
    expect((await as(w, await addMember(w, company, 'member'))('POST', path)).status).toBe(403);
    expect(await as(w, await addMember(w, company, 'admin'))('POST', path)).toMatchObject({
      status: 403,
      body: { error: { code: 'forbidden' } },
    });
    const other = await membersCompany(w);
    const theirs = await invite(w, other, 'theirs@x.test');
    for (const id of ['019a4f0c-0000-7000-8000-000000000000', 'not-a-uuid', theirs.id]) {
      expect(await as(w, company.owner)('POST', `${oneOf(company, id)}/resend`)).toMatchObject({
        status: 404,
        body: { error: { code: 'invitation_not_found' } },
      });
    }
  });
});

describe('DELETE /api/companies/:companyId/invitations/:invitationId', () => {
  it('revokes a pending invitation locally first, with its audit row and the outbox revoke call, once', async () => {
    const company = await membersCompany(w);
    const sent = await invite(w, company, 'revoke-me@x.test', 'viewer');
    expect((await as(w, company.owner, 'req-revoke')('DELETE', oneOf(company, sent.id))).status).toBe(204);
    expect(await invitationRow(w, sent.id)).toMatchObject({ status: 'revoked' });
    const revokes = await outboxRows(w, company.companyId, 'revoke_invite');
    expect(revokes).toEqual([
      expect.objectContaining({
        status: 'pending',
        idempotencyKey: `revoke_invite:${sent.id}`,
        payload: { invitationId: sent.id },
      }),
    ]);
    expect((await invitationAudit(company.companyId)).filter((row) => row.action === 'revoke')).toEqual([
      expect.objectContaining({
        actorPrincipalId: company.owner.principalId,
        requestId: 'req-revoke',
        field: 'status',
        oldValue: 'pending',
        newValue: 'revoked',
      }),
    ]);
    // Again: nothing more is written.
    expect((await as(w, company.owner)('DELETE', oneOf(company, sent.id))).status).toBe(204);
    expect(await outboxRows(w, company.companyId, 'revoke_invite')).toHaveLength(1);
    expect((await invitationAudit(company.companyId)).filter((row) => row.action === 'revoke')).toHaveLength(
      1,
    );
  });

  it('is a 409 for an invitation past its expiry, a 404 for an unknown one, a 403 and a 401', async () => {
    const company = await membersCompany(w);
    const overdue = await invite(w, company, 'too-late@x.test');
    const forOwner = await invite(w, company, 'owner-to-be@x.test', 'owner');
    w.clock.advance(14 * DAY_MS);
    expect(await as(w, company.owner)('DELETE', oneOf(company, overdue.id))).toMatchObject({
      status: 409,
      body: { error: { code: 'invitation_not_pending' } },
    });
    expect(await as(w, company.owner)('DELETE', oneOf(company, 'not-a-uuid'))).toMatchObject({
      status: 404,
      body: { error: { code: 'invitation_not_found' } },
    });
    const admin = await addMember(w, company, 'admin');
    expect((await as(w, admin)('DELETE', oneOf(company, forOwner.id))).status).toBe(403);
    expect(
      (await as(w, await addMember(w, company, 'viewer'))('DELETE', oneOf(company, overdue.id))).status,
    ).toBe(403);
    expect((await call(w, undefined)('DELETE', oneOf(company, overdue.id))).status).toBe(401);
    const other = await membersCompany(w);
    expect((await as(w, other.owner)('DELETE', oneOf(company, overdue.id))).status).toBe(404);
  });
});
