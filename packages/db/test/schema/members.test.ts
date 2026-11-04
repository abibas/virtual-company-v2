import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawDbHandle } from '../../src/handle.ts';
import { type Company, invitations, memberships, type NewInvitation } from '../../src/schema/index.ts';
import { pgError, type TestDb } from '../../src/testing.ts';
import {
  insertCompany,
  insertInvitation,
  insertMember,
  insertPrincipal,
  insertUser,
  inTwoWeeks,
  MISSING_ID,
  migratedTestDb,
  unique,
} from '../fixtures/rows.ts';

let testDb: TestDb;
let handle: RawDbHandle;
let acme: Company;
let globex: Company;

beforeAll(async () => {
  testDb = await migratedTestDb();
  handle = testDb.handle;
  acme = await insertCompany(handle);
  globex = await insertCompany(handle);
});
afterAll(() => testDb.close());

describe('memberships', () => {
  it('stores a person in a company with their principal there, active by default', async () => {
    const { membership, principal, user } = await insertMember(handle, acme.id, { role: 'admin' });
    expect(membership).toMatchObject({
      companyId: acme.id,
      principalId: principal.id,
      userId: user.id,
      role: 'admin',
      grantedRole: 'member',
      status: 'active',
      externalMembershipId: null,
      providerRole: null,
      invitationId: null,
    });
    expect(principal.kind).toBe('person');
  });

  it('allows one membership per company and user, and one per principal', async () => {
    const { user, principal } = await insertMember(handle, acme.id);
    const another = await insertPrincipal(handle, acme.id);
    const twice = handle.db.insert(memberships).values({
      companyId: acme.id,
      principalId: another.id,
      userId: user.id,
      role: 'member',
      grantedRole: 'member',
    });
    expect(await pgError(twice)).toMatchObject({
      code: '23505',
      constraint: 'memberships_company_id_user_id_unique',
    });
    const sharedPrincipal = handle.db.insert(memberships).values({
      companyId: acme.id,
      principalId: principal.id,
      userId: (await insertUser(handle)).id,
      role: 'member',
      grantedRole: 'member',
    });
    expect(await pgError(sharedPrincipal)).toMatchObject({
      code: '23505',
      constraint: 'memberships_company_id_principal_id_unique',
    });
    // The same person in another company is another membership, with another principal.
    await expect(insertMember(handle, globex.id, { userId: user.id })).resolves.toBeDefined();
  });

  it("refuses another company's principal or invitation (composite keys), and an unknown user", async () => {
    const theirs = await insertPrincipal(handle, globex.id);
    const crossPrincipal = handle.db.insert(memberships).values({
      companyId: acme.id,
      principalId: theirs.id,
      userId: (await insertUser(handle)).id,
      role: 'member',
      grantedRole: 'member',
    });
    expect(await pgError(crossPrincipal)).toMatchObject({
      code: '23503',
      constraint: 'memberships_principal_fk',
    });

    const theirInvitation = await insertInvitation(handle, globex.id);
    const crossInvitation = insertMember(handle, acme.id, { invitationId: theirInvitation.id });
    expect(await pgError(crossInvitation)).toMatchObject({
      code: '23503',
      constraint: 'memberships_invitation_fk',
    });
    const ours = await insertInvitation(handle, acme.id);
    await expect(insertMember(handle, acme.id, { invitationId: ours.id })).resolves.toBeDefined();

    expect(await pgError(insertMember(handle, acme.id, { userId: MISSING_ID }))).toMatchObject({
      code: '23503',
      constraint: 'memberships_user_id_users_id_fk',
    });
  });

  it.each([
    ['role', 'memberships_role_check'],
    ['grantedRole', 'memberships_granted_role_check'],
    ['status', 'memberships_status_check'],
  ] as const)('refuses an unknown %s', async (column, constraint) => {
    const query = insertMember(handle, acme.id, { [column]: 'boss' });
    expect(await pgError(query)).toMatchObject({ code: '23514', constraint });
  });
});

describe('invitations', () => {
  it('stores an invitation, pending by default', async () => {
    const inviter = await insertPrincipal(handle, acme.id);
    const invitation = await insertInvitation(handle, acme.id, { invitedByPrincipalId: inviter.id });
    expect(invitation).toMatchObject({
      companyId: acme.id,
      role: 'member',
      status: 'pending',
      externalInvitationId: null,
      invitedByPrincipalId: inviter.id,
      acceptedByUserId: null,
    });
    expect(invitation.expiresAt).toBeInstanceOf(Date);
  });

  it('allows one pending invitation per email and company (a partial unique index)', async () => {
    const email = `${unique('pending')}@x.test`;
    const first = await insertInvitation(handle, acme.id, { emailNormalized: email });
    expect(await pgError(insertInvitation(handle, acme.id, { emailNormalized: email }))).toMatchObject({
      code: '23505',
      constraint: 'invitations_one_pending_per_email',
    });
    // Another company may invite the same email, and so may this one once the first is no longer pending.
    await insertInvitation(handle, globex.id, { emailNormalized: email });
    await insertInvitation(handle, acme.id, { emailNormalized: email, status: 'revoked' });
    await handle.db.update(invitations).set({ status: 'accepted' }).where(eq(invitations.id, first.id));
    await expect(insertInvitation(handle, acme.id, { emailNormalized: email })).resolves.toBeDefined();
  });

  it("refuses an upper-case email, a taken provider id and another company's inviter", async () => {
    expect(await pgError(insertInvitation(handle, acme.id, { emailNormalized: 'Bob@X.test' }))).toMatchObject(
      {
        code: '23514',
        constraint: 'invitations_email_lower_check',
      },
    );
    const externalInvitationId = unique('orginv');
    await insertInvitation(handle, acme.id, { externalInvitationId });
    expect(await pgError(insertInvitation(handle, globex.id, { externalInvitationId }))).toMatchObject({
      code: '23505',
      constraint: 'invitations_external_invitation_id_unique',
    });
    const theirs = await insertPrincipal(handle, globex.id);
    expect(
      await pgError(insertInvitation(handle, acme.id, { invitedByPrincipalId: theirs.id })),
    ).toMatchObject({
      code: '23503',
      constraint: 'invitations_invited_by_principal_fk',
    });
    expect(await pgError(insertInvitation(handle, acme.id, { acceptedByUserId: MISSING_ID }))).toMatchObject({
      code: '23503',
      constraint: 'invitations_accepted_by_user_id_users_id_fk',
    });
  });

  it.each([
    ['role', 'invitations_role_check'],
    ['status', 'invitations_status_check'],
  ] as const)('refuses an unknown %s', async (column, constraint) => {
    expect(await pgError(insertInvitation(handle, acme.id, { [column]: 'maybe' }))).toMatchObject({
      code: '23514',
      constraint,
    });
  });

  it('needs an expiry', async () => {
    // expiresAt is required in the type too; the database refuses a null as well.
    const values = {
      companyId: acme.id,
      emailNormalized: `${unique('x')}@x.test`,
      role: 'member',
      expiresAt: null,
    };
    const query = handle.db.insert(invitations).values(values as unknown as NewInvitation);
    expect((await pgError(query)).code).toBe('23502');
    expect(inTwoWeeks().getTime()).toBeGreaterThan(Date.now());
  });
});
