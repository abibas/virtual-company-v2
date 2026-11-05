import { memberships, tenant } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { getJson } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { membersService } from '../../../../src/modules/members/service.ts';
import { type AuthWorld, authWorld, bearer, type Person, seedApiKey } from '../../../fixtures/auth.ts';
import { auditFields, auditOf, outboxOf } from '../../../fixtures/companies.ts';
import {
  activeOwners,
  addMember,
  as,
  keyRow,
  type MembersCompany,
  memberPath,
  membersCompany,
  membershipRow,
  ROLES,
} from '../../../fixtures/members.ts';
import { testChart } from '../../../fixtures/org.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

const remove = (company: MembersCompany, actor: Person, target: Person, requestId?: string) =>
  as(w, actor, requestId)('DELETE', memberPath(company, target));

const removals = async (companyId: string) =>
  (await outboxOf(w.t.db, companyId)).filter((r) => r.op === 'remove_member');

describe('DELETE /api/companies/:companyId/members/:membershipId', () => {
  it('ends access at once: removed membership, revoked keys, audit rows, then the outbox remove_member call', async () => {
    const company = await membersCompany(w);
    const target = await addMember(w, company, 'admin');
    const bystander = await addMember(w, company, 'member');
    const key = await seedApiKey(w.t.db, { companyId: company.companyId, principalId: target.principalId });
    const second = await seedApiKey(w.t.db, {
      companyId: company.companyId,
      principalId: target.principalId,
    });
    const earlier = new Date(w.clock().getTime() - 60_000);
    const old = await seedApiKey(w.t.db, {
      companyId: company.companyId,
      principalId: target.principalId,
      revokedAt: earlier,
    });
    const kept = await seedApiKey(w.t.db, {
      companyId: company.companyId,
      principalId: bystander.principalId,
    });
    const companyPath = `/api/companies/${company.companyId}`;
    expect((await getJson(w.t.app, company.members, bearer(key.key))).status).toBe(200);

    expect(await remove(company, company.owner, target, 'req-remove-1')).toMatchObject({
      status: 204,
      body: null,
    });
    expect(await membershipRow(w.t.db, target.membershipId)).toMatchObject({
      status: 'removed',
      role: 'admin',
    });
    expect((await keyRow(w.t.db, key.id))?.revokedAt).toEqual(w.clock());
    expect((await keyRow(w.t.db, second.id))?.revokedAt).toEqual(w.clock());
    expect((await keyRow(w.t.db, old.id))?.revokedAt).toEqual(earlier);
    expect((await keyRow(w.t.db, kept.id))?.revokedAt).toBeNull();

    // Their session is a non-member now (404) and their key is refused (401); everyone else is unaffected.
    for (const path of [companyPath, company.members]) {
      expect(await as(w, target)('GET', path)).toMatchObject({
        status: 404,
        body: { error: { code: 'not_found' } },
      });
      expect(await getJson(w.t.app, path, bearer(key.key))).toMatchObject({
        status: 401,
        body: { error: { code: 'unauthenticated', message: 'The API key was revoked' } },
      });
    }
    expect((await getJson(w.t.app, company.members, bearer(kept.key))).status).toBe(200);
    const listed = (await as(w, company.owner)('GET', company.members)).body as { members: { id: string }[] };
    expect(listed.members.map((m) => m.id)).toEqual([company.owner.membershipId, bystander.membershipId]);

    const actor = {
      actorKind: 'user',
      actorPrincipalId: company.owner.principalId,
      requestId: 'req-remove-1',
    };
    const at = w.clock().toISOString();
    const [first, ...revoked] = auditFields(await auditOf(w.t.db, company.companyId));
    const entity = { companyId: company.companyId, ...actor };
    expect(first).toEqual({
      ...entity,
      entityType: 'membership',
      entityId: target.membershipId,
      action: 'remove',
      field: 'status',
      oldValue: 'active',
      newValue: 'removed',
    });
    const revocation = {
      ...entity,
      entityType: 'api_key',
      action: 'revoke',
      field: 'revokedAt',
      oldValue: null,
    };
    expect(revoked.sort((a, b) => a.entityId.localeCompare(b.entityId))).toEqual(
      [key.id, second.id].sort().map((entityId) => ({ ...revocation, entityId, newValue: at })),
    );
    const outbox = await removals(company.companyId);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ status: 'pending', payload: { membershipId: target.membershipId } });
    expect(outbox[0]?.idempotencyKey).toMatch(
      new RegExp(`^remove_member:${target.membershipId}:[0-9a-f-]{36}$`),
    );

    expect(await remove(company, company.owner, target)).toMatchObject({
      status: 404,
      body: { error: { code: 'member_not_found' } },
    });
    expect(await removals(company.companyId)).toHaveLength(1);
  });

  it('gives a membership removed, then re-activated, a second remove_member call when removed again', async () => {
    const company = await membersCompany(w);
    const target = await addMember(w, company, 'member');
    expect((await remove(company, company.owner, target)).status).toBe(204);
    await rawDb(w.t.db)
      .update(memberships)
      .set({ status: 'active' })
      .where(eq(memberships.id, target.membershipId));
    expect((await remove(company, company.owner, target)).status).toBe(204);
    expect(await removals(company.companyId)).toHaveLength(2);
  });

  for (const actorRole of ROLES) {
    it(`applies the removal rules to a${actorRole === 'owner' || actorRole === 'admin' ? 'n' : ''} ${actorRole} removing every role`, async () => {
      const company = await membersCompany(w);
      const actor = await addMember(w, company, actorRole);
      for (const targetRole of ROLES) {
        const target = await addMember(w, company, targetRole);
        const allowed = actorRole === 'owner' || (actorRole === 'admin' && targetRole !== 'owner');
        const res = await remove(company, actor, target);
        expect([targetRole, res.status]).toEqual([targetRole, allowed ? 204 : 403]);
        if (!allowed) expect(res.body).toMatchObject({ error: { code: 'forbidden' } });
        expect((await membershipRow(w.t.db, target.membershipId))?.status).toBe(
          allowed ? 'removed' : 'active',
        );
      }
    });
  }

  it('words the refusals', async () => {
    const company = await membersCompany(w);
    const admin = await addMember(w, company, 'admin');
    const member = await addMember(w, company, 'member');
    expect((await remove(company, admin, company.owner)).body).toMatchObject({
      error: { message: 'Only an owner may remove an owner' },
    });
    expect((await remove(company, member, admin)).body).toMatchObject({
      error: { message: 'Only an owner or an admin may remove someone else' },
    });
    expect(await outboxOf(w.t.db, company.companyId)).toEqual([]);
  });

  it('lets anyone leave, and an owner while another active owner stays', async () => {
    const company = await membersCompany(w);
    for (const role of ROLES) {
      const person = await addMember(w, company, role);
      const key = await seedApiKey(w.t.db, { companyId: company.companyId, principalId: person.principalId });
      expect([role, (await remove(company, person, person, `req-leave-${role}`)).status]).toEqual([
        role,
        204,
      ]);
      expect((await as(w, person)('GET', company.members)).status).toBe(404);
      expect((await keyRow(w.t.db, key.id))?.revokedAt).toEqual(w.clock());
      const own = auditFields(await auditOf(w.t.db, company.companyId)).filter(
        (r) => r.entityId === person.membershipId,
      );
      expect(own).toMatchObject([
        { actorPrincipalId: person.principalId, action: 'remove', newValue: 'removed' },
      ]);
    }
    expect(await removals(company.companyId)).toHaveLength(4);
  });
});

describe('the last-owner guard on removals', () => {
  it('refuses removing or letting go the last active owner with 409 last_owner and writes nothing', async () => {
    const company = await membersCompany(w);
    const key = await seedApiKey(w.t.db, {
      companyId: company.companyId,
      principalId: company.owner.principalId,
    });
    const suspended = await addMember(w, company, 'owner', 'suspended');
    expect(await remove(company, company.owner, company.owner)).toMatchObject({
      status: 409,
      body: { error: { code: 'last_owner' } },
    });
    expect(await membershipRow(w.t.db, company.owner.membershipId)).toMatchObject({ status: 'active' });
    expect((await keyRow(w.t.db, key.id))?.revokedAt).toBeNull();
    expect(await outboxOf(w.t.db, company.companyId)).toEqual([]);
    expect(await auditOf(w.t.db, company.companyId)).toEqual([]);

    expect((await remove(company, company.owner, suspended)).status).toBe(204);
    const second = await addMember(w, company, 'owner');
    expect((await remove(company, second, company.owner)).status).toBe(204);
    expect((await remove(company, second, second)).status).toBe(409);
    expect(await activeOwners(w.t.db, company.companyId)).toEqual([second.membershipId]);
  });

  it('keeps exactly one owner when the last two owners leave at the same time', async () => {
    for (let round = 0; round < 3; round++) {
      const company = await membersCompany(w);
      const second = await addMember(w, company, 'owner');
      const answers = await Promise.all([
        remove(company, company.owner, company.owner),
        remove(company, second, second),
      ]);
      expect(answers.map((res) => res.status).sort()).toEqual([204, 409]);
      expect(await activeOwners(w.t.db, company.companyId)).toHaveLength(1);
    }
  });
});

describe('membersService.remove', () => {
  it('refuses an acting member who was removed meanwhile', async () => {
    const company = await membersCompany(w);
    const admin = await addMember(w, company, 'admin');
    const target = await addMember(w, company, 'member');
    await rawDb(w.t.db)
      .update(memberships)
      .set({ status: 'removed' })
      .where(eq(memberships.id, admin.membershipId));
    const result = await membersService({ db: w.t.db, chart: testChart() }).remove(
      await tenant(w.t.db, company.companyId),
      {
        actorId: admin.membershipId,
        membershipId: target.membershipId,
        requestId: 'req',
        now: w.clock(),
      },
    );
    expect(result).toMatchObject({ ok: false, status: 403, code: 'forbidden' });
    expect((await membershipRow(w.t.db, target.membershipId))?.status).toBe('active');
  });
});
