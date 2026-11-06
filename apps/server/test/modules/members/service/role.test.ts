import { memberships, tenant } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { MembershipRole } from '@mwc/shared/enums';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { membersService } from '../../../../src/modules/members/service.ts';
import { auditFields, auditOf, outboxOf } from '../../../fixtures/companies/companies.ts';
import {
  activeOwners,
  addMember,
  as,
  type MembersCompany,
  memberPath,
  membersCompany,
  membershipRow,
  ROLES,
} from '../../../fixtures/members/members.ts';
import { testChart } from '../../../fixtures/org.ts';
import { type AuthWorld, authWorld, type Person } from '../../../fixtures/platform/auth.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

const patch = (
  company: MembersCompany,
  actor: Person,
  target: Person,
  role: MembershipRole,
  requestId?: string,
) => as(w, actor, requestId)('PATCH', memberPath(company, target), { role });

/** The company's role-change rows: its outbox calls and its membership audit rows. */
const written = async (companyId: string) => ({
  outbox: (await outboxOf(w.t.db, companyId))
    .filter((row) => row.op === 'update_role')
    .sort((a, b) => a.id.localeCompare(b.id)),
  audit: auditFields(await auditOf(w.t.db, companyId)).filter((row) => row.entityType === 'membership'),
});

describe('PATCH /api/companies/:companyId/members/:membershipId', () => {
  it('changes the role locally first, audits each changed field and enqueues update_role', async () => {
    const company = await membersCompany(w);
    const target = await addMember(w, company, 'member');
    const res = await patch(company, company.owner, target, 'admin', 'req-role-1');
    expect(res).toMatchObject({
      status: 200,
      body: { id: target.membershipId, userId: target.userId, displayName: target.subject, role: 'admin' },
    });
    expect(await membershipRow(w.t.db, target.membershipId)).toMatchObject({
      role: 'admin',
      grantedRole: 'admin',
      status: 'active',
    });
    const { outbox, audit } = await written(company.companyId);
    const entity = { companyId: company.companyId, entityType: 'membership', entityId: target.membershipId };
    const actor = { actorKind: 'user', actorPrincipalId: company.owner.principalId, requestId: 'req-role-1' };
    expect(audit).toEqual([
      { ...entity, ...actor, action: 'update', field: 'grantedRole', oldValue: 'member', newValue: 'admin' },
      { ...entity, ...actor, action: 'update', field: 'role', oldValue: 'member', newValue: 'admin' },
    ]);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      op: 'update_role',
      status: 'pending',
      attempts: 0,
      payload: { membershipId: target.membershipId, role: 'admin' },
    });
    expect(outbox[0]?.idempotencyKey).toMatch(
      new RegExp(`^update_role:${target.membershipId}:[0-9a-f-]{36}$`),
    );

    // Back and forth: each change is its own outbox call, under its own key.
    await patch(company, company.owner, target, 'member');
    await patch(company, company.owner, target, 'admin');
    const after = await written(company.companyId);
    expect(after.outbox.map((row) => row.payload.role)).toEqual(['admin', 'member', 'admin']);
    expect(new Set(after.outbox.map((row) => row.idempotencyKey)).size).toBe(3);
    expect(after.audit).toHaveLength(6);
  });

  it('is a no-op for the role the member has already: 200, no audit row, no outbox call', async () => {
    const company = await membersCompany(w);
    const target = await addMember(w, company, 'viewer');
    expect(await patch(company, company.owner, target, 'viewer')).toMatchObject({
      status: 200,
      body: { id: target.membershipId, role: 'viewer' },
    });
    expect(await patch(company, company.owner, company.owner, 'owner')).toMatchObject({ status: 200 });
    expect(await written(company.companyId)).toEqual({ outbox: [], audit: [] });
  });

  it('settles a role the provider raised: only the fields that differ are written', async () => {
    const company = await membersCompany(w);
    const raised = await addMember(w, company, 'member');
    const scoped = await tenant(w.t.db, company.companyId);
    await scoped.update(
      memberships,
      { role: 'admin', providerRole: 'org:admin' },
      eq(memberships.id, raised.membershipId),
    );
    const keep = await addMember(w, company, 'member');
    await scoped.update(
      memberships,
      { role: 'admin', providerRole: 'org:admin' },
      eq(memberships.id, keep.membershipId),
    );

    await patch(company, company.owner, raised, 'member', 'req-settle');
    await patch(company, company.owner, keep, 'admin', 'req-keep');
    const fields = (await written(company.companyId)).audit.map((r) => [
      r.entityId,
      r.field,
      r.oldValue,
      r.newValue,
    ]);
    expect(fields).toEqual([
      [raised.membershipId, 'role', 'admin', 'member'],
      [keep.membershipId, 'grantedRole', 'member', 'admin'],
    ]);
    expect(await membershipRow(w.t.db, raised.membershipId)).toMatchObject({
      role: 'member',
      grantedRole: 'member',
    });
    expect(await membershipRow(w.t.db, keep.membershipId)).toMatchObject({
      role: 'admin',
      grantedRole: 'admin',
    });
  });

  for (const actorRole of ROLES) {
    it(`applies the role rules to a${actorRole === 'owner' || actorRole === 'admin' ? 'n' : ''} ${actorRole} acting on every role`, async () => {
      const company = await membersCompany(w);
      const actor = await addMember(w, company, actorRole);
      for (const targetRole of ROLES) {
        for (const next of ROLES) {
          const target = await addMember(w, company, targetRole);
          const allowed =
            actorRole === 'owner' || (actorRole === 'admin' && targetRole !== 'owner' && next !== 'owner');
          const res = await patch(company, actor, target, next);
          expect([targetRole, next, res.status]).toEqual([targetRole, next, allowed ? 200 : 403]);
          if (!allowed) expect(res.body).toMatchObject({ error: { code: 'forbidden' } });
          const row = await membershipRow(w.t.db, target.membershipId);
          expect(row?.role).toBe(allowed ? next : targetRole);
        }
      }
    });
  }

  it('words the refusals of an admin', async () => {
    const company = await membersCompany(w);
    const admin = await addMember(w, company, 'admin');
    const member = await addMember(w, company, 'member');
    expect((await patch(company, admin, company.owner, 'admin')).body).toMatchObject({
      error: { code: 'forbidden', message: "Only an owner may change an owner's role" },
    });
    expect((await patch(company, admin, member, 'owner')).body).toMatchObject({
      error: { code: 'forbidden', message: 'Only an owner may make someone an owner' },
    });
    expect(await patch(company, admin, admin, 'viewer')).toMatchObject({
      status: 200,
      body: { role: 'viewer' },
    });
  });
});

describe('the last-owner guard on role changes', () => {
  it('refuses to demote the last active owner with 409 last_owner and writes nothing', async () => {
    const company = await membersCompany(w);
    const suspended = await addMember(w, company, 'owner', 'suspended');
    for (const next of ['admin', 'member', 'viewer'] as const) {
      expect(await patch(company, company.owner, company.owner, next)).toMatchObject({
        status: 409,
        body: { error: { code: 'last_owner', message: 'The company must keep at least one active owner' } },
      });
    }
    expect(await written(company.companyId)).toEqual({ outbox: [], audit: [] });
    // A suspended owner is no active owner: demoting them leaves the count as it is.
    expect((await patch(company, company.owner, suspended, 'member')).status).toBe(200);

    const second = await addMember(w, company, 'owner');
    expect((await patch(company, company.owner, second, 'admin')).status).toBe(200);
    expect((await patch(company, company.owner, company.owner, 'admin')).status).toBe(409);
    expect((await patch(company, company.owner, second, 'owner')).status).toBe(200);
    expect((await patch(company, second, company.owner, 'member')).status).toBe(200);
    expect(await activeOwners(w.t.db, company.companyId)).toEqual([second.membershipId]);
  });

  it('keeps exactly one owner when the last two owners demote themselves at the same time', async () => {
    for (let round = 0; round < 3; round++) {
      const company = await membersCompany(w);
      const second = await addMember(w, company, 'owner');
      const answers = await Promise.all([
        patch(company, company.owner, company.owner, 'admin'),
        patch(company, second, second, 'member'),
      ]);
      expect(answers.map((res) => res.status).sort()).toEqual([200, 409]);
      expect(await activeOwners(w.t.db, company.companyId)).toHaveLength(1);
    }
  });

  it('keeps exactly one owner when the last two owners demote each other at the same time', async () => {
    for (let round = 0; round < 3; round++) {
      const company = await membersCompany(w);
      const second = await addMember(w, company, 'owner');
      const answers = await Promise.all([
        patch(company, company.owner, second, 'admin'),
        patch(company, second, company.owner, 'admin'),
      ]);
      // The loser is refused by the guard (409) or, now an admin itself, by the owner rule (403).
      expect(answers.filter((res) => res.status === 200)).toHaveLength(1);
      expect(answers.every((res) => [200, 403, 409].includes(res.status))).toBe(true);
      expect(await activeOwners(w.t.db, company.companyId)).toHaveLength(1);
    }
  });
});

describe('membersService.changeRole', () => {
  it('decides with the acting member as they are under the lock, not as the request found them', async () => {
    const company = await membersCompany(w);
    const admin = await addMember(w, company, 'admin');
    const target = await addMember(w, company, 'member');
    const scoped = await tenant(w.t.db, company.companyId);
    const service = membersService({ db: w.t.db, chart: testChart() });
    await rawDb(w.t.db)
      .update(memberships)
      .set({ role: 'member', grantedRole: 'member' })
      .where(eq(memberships.id, admin.membershipId));
    const call = {
      actorId: admin.membershipId,
      membershipId: target.membershipId,
      role: 'viewer' as const,
      requestId: 'req',
    };
    expect(await service.changeRole(scoped, call)).toMatchObject({
      ok: false,
      status: 403,
      code: 'forbidden',
    });
    await rawDb(w.t.db)
      .update(memberships)
      .set({ status: 'removed' })
      .where(eq(memberships.id, admin.membershipId));
    expect(await service.changeRole(scoped, call)).toEqual({
      ok: false,
      status: 403,
      code: 'forbidden',
      message: 'You are no longer an active member of this company',
    });
    expect((await membershipRow(w.t.db, target.membershipId))?.role).toBe('member');
  });
});
