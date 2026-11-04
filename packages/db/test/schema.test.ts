import { isId } from '@mwc/shared/ids';
import { eq, sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawDbHandle } from '../src/handle.ts';
import { queryRows } from '../src/handle.ts';
import { migrateToLatest } from '../src/migrate.ts';
import { auditLog, companies, users } from '../src/schema/index.ts';
import { createTestDb, pgError, type TestDb } from '../src/testing.ts';

let testDb: TestDb;
let handle: RawDbHandle;
let seq = 0;
const unique = (prefix: string) => `${prefix}-${++seq}`;

beforeAll(async () => {
  testDb = await createTestDb();
  handle = testDb.handle;
  await migrateToLatest(handle);
});
afterAll(async () => {
  await testDb.close();
});

async function insertUser(email = `${unique('user')}@example.com`) {
  const [user] = await handle.db
    .insert(users)
    .values({ primaryEmail: email, displayName: 'Ihor' })
    .returning();
  if (!user) throw new Error('no user returned');
  return user;
}

describe('users', () => {
  it('stores a user with an app-side UUID v7 and the defaults', async () => {
    const user = await insertUser('ihor@example.com');
    expect(isId(user.id)).toBe(true);
    expect(user.status).toBe('active');
    expect(user.imageUrl).toBeNull();
    expect(user.createdAt).toBeInstanceOf(Date);
    const [read] = await handle.db.select().from(users).where(eq(users.id, user.id));
    expect(read).toEqual(user);
  });

  it('refuses an upper-case email', async () => {
    const error = await pgError(
      handle.db.insert(users).values({ primaryEmail: 'Ihor@Example.com', displayName: 'Ihor' }),
    );
    expect(error).toMatchObject({ code: '23514', constraint: 'users_primary_email_lower_check' });
  });

  it('keeps two people with one email apart (identity is issuer and subject), and refuses an unknown status', async () => {
    const first = await insertUser('twice@example.com');
    const second = await insertUser('twice@example.com');
    expect(second.id).not.toBe(first.id);
    const badStatus = handle.db
      .insert(users)
      // @ts-expect-error status is typed as UserStatus; the database refuses it as well
      .values({ primaryEmail: `${unique('banned')}@example.com`, displayName: 'x', status: 'banned' });
    expect(await pgError(badStatus)).toMatchObject({ code: '23514', constraint: 'users_status_check' });
  });
});

describe('companies', () => {
  it('stores a company with its defaults and reads it back', async () => {
    const owner = await insertUser();
    const [company] = await handle.db
      .insert(companies)
      .values({ slug: 'most-wanted', name: 'Most Wanted Corp', createdByUserId: owner.id })
      .returning();
    expect(company).toMatchObject({
      slug: 'most-wanted',
      status: 'provisioning',
      identityProvider: 'clerk',
      identityOrgId: null,
      settings: {},
      deletedAt: null,
      createdByUserId: owner.id,
    });
    expect(isId(company?.id ?? '')).toBe(true);
    const [read] = await handle.db.select().from(companies).where(eq(companies.slug, 'most-wanted'));
    expect(read).toEqual(company);
  });

  it('keeps settings as jsonb and bumps updated_at on update', async () => {
    const [company] = await handle.db
      .insert(companies)
      .values({ slug: unique('acme'), name: 'Acme' })
      .returning();
    if (!company) throw new Error('no company returned');
    const [updated] = await handle.db
      .update(companies)
      .set({ settings: { theme: { dark: true }, seats: 3 }, status: 'active' })
      .where(eq(companies.id, company.id))
      .returning();
    expect(updated?.settings).toEqual({ theme: { dark: true }, seats: 3 });
    expect(updated?.status).toBe('active');
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(company.updatedAt.getTime());
  });

  it('refuses a duplicate slug and a duplicate identity org id', async () => {
    await handle.db.insert(companies).values({ slug: 'taken', name: 'One', identityOrgId: 'org_1' });
    expect(await pgError(handle.db.insert(companies).values({ slug: 'taken', name: 'Two' }))).toMatchObject({
      code: '23505',
      constraint: 'companies_slug_unique',
    });
    expect(
      await pgError(
        handle.db.insert(companies).values({ slug: unique('other'), name: 'Two', identityOrgId: 'org_1' }),
      ),
    ).toMatchObject({ code: '23505', constraint: 'companies_identity_org_id_unique' });
  });

  it('refuses an unknown status', async () => {
    // @ts-expect-error status is typed as CompanyStatus; the database refuses it as well
    const query = handle.db.insert(companies).values({ slug: unique('s'), name: 'S', status: 'archived' });
    expect(await pgError(query)).toMatchObject({ code: '23514', constraint: 'companies_status_check' });
  });

  it.each(['Acme', '-acme', 'acme-', 'ac_me', 'acme corp', '', 'a'.repeat(64)])(
    'refuses the slug %j',
    async (slug) => {
      expect(await pgError(handle.db.insert(companies).values({ slug, name: 'Bad' }))).toMatchObject({
        code: '23514',
        constraint: 'companies_slug_check',
      });
    },
  );

  it.each(['a', '7', 'acme-corp', 'a--b', 'b'.repeat(63)])('accepts the slug %j', async (slug) => {
    await expect(handle.db.insert(companies).values({ slug, name: 'Good' })).resolves.toBeDefined();
  });

  it('refuses a creator that is not a user', async () => {
    const query = handle.db.insert(companies).values({
      slug: unique('orphan'),
      name: 'Orphan',
      createdByUserId: '0190f5f0-0000-7000-8000-000000000000',
    });
    expect(await pgError(query)).toMatchObject({
      code: '23503',
      constraint: 'companies_created_by_user_id_users_id_fk',
    });
  });
});

describe('audit_log', () => {
  it('stores a company event and a global event, with jsonb values', async () => {
    const [company] = await handle.db
      .insert(companies)
      .values({ slug: unique('audited'), name: 'A' })
      .returning();
    const rows = await handle.db
      .insert(auditLog)
      .values([
        {
          companyId: company?.id ?? null,
          actorKind: 'user',
          entityType: 'company',
          entityId: company?.id ?? '',
          action: 'update',
          field: 'name',
          oldValue: 'A',
          newValue: { text: 'B', tags: ['x'] },
          requestId: 'req-1',
        },
        { actorKind: 'identity', entityType: 'user', entityId: 'u1', action: 'deactivate' },
      ])
      .returning();
    expect(rows).toHaveLength(2);
    const [first, second] = rows;
    expect(first).toMatchObject({
      companyId: company?.id,
      oldValue: 'A',
      newValue: { text: 'B', tags: ['x'] },
    });
    expect(typeof first?.id).toBe('number');
    expect(second).toMatchObject({ companyId: null, field: null, oldValue: null, newValue: null });
    expect(second?.id).toBeGreaterThan(first?.id ?? 0);
  });

  it('refuses an unknown actor kind and an unknown company', async () => {
    const badKind = handle.db
      .insert(auditLog)
      // @ts-expect-error actorKind is typed as ActorKind; the database refuses it as well
      .values({ actorKind: 'robot', entityType: 'user', entityId: 'u1', action: 'x' });
    expect(await pgError(badKind)).toMatchObject({ code: '23514', constraint: 'audit_log_actor_kind_check' });
    const badCompany = handle.db.insert(auditLog).values({
      companyId: '0190f5f0-0000-7000-8000-000000000000',
      actorKind: 'system',
      entityType: 'company',
      entityId: 'c1',
      action: 'x',
    });
    expect(await pgError(badCompany)).toMatchObject({
      code: '23503',
      constraint: 'audit_log_company_id_companies_id_fk',
    });
  });

  it('has the entity index', async () => {
    const [row] = await queryRows<{ indexdef: string }>(
      handle,
      sql`select indexdef from pg_indexes where indexname = 'audit_log_entity_idx'`,
    );
    expect(row?.indexdef).toContain('(company_id, entity_type, entity_id, id)');
  });
});

describe('schema shape', () => {
  it('points the foreign keys at the right tables', () => {
    const targets = (table: Parameters<typeof getTableConfig>[0]) =>
      getTableConfig(table).foreignKeys.map((fk) => {
        const ref = fk.reference();
        return `${ref.columns.map((c) => c.name).join(',')} -> ${getTableConfig(ref.foreignTable).name}(${ref.foreignColumns.map((c) => c.name).join(',')})`;
      });
    expect(targets(companies)).toEqual(['created_by_user_id -> users(id)']);
    expect(targets(auditLog)).toEqual([
      'company_id -> companies(id)',
      'company_id,actor_principal_id -> principals(company_id,id)',
    ]);
    expect(targets(users)).toEqual([]);
  });

  it('pgError insists that the query fails', async () => {
    await expect(pgError(Promise.resolve(1))).rejects.toThrow('expected the query to fail');
  });
});
