import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawDbHandle } from '../../src/handle.ts';
import { type Company, companies, companyLogos, type NewCompanyLogo } from '../../src/schema/index.ts';
import { pgError, type TestDb } from '../../src/testing.ts';
import { insertCompany, insertPrincipal, MISSING_ID, migratedTestDb } from '../fixtures/rows.ts';

let testDb: TestDb;
let handle: RawDbHandle;
let globex: Company;

/** The eight bytes every PNG starts with, and a few more. */
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

beforeAll(async () => {
  testDb = await migratedTestDb();
  handle = testDb.handle;
  globex = await insertCompany(handle);
});
afterAll(() => testDb.close());

function logo(companyId: string, values: Partial<NewCompanyLogo> = {}) {
  return handle.db
    .insert(companyLogos)
    .values({
      companyId,
      contentType: 'image/png',
      bytes: PNG,
      size: PNG.length,
      sha256: hash(PNG),
      ...values,
    })
    .returning();
}

describe('company_logos', () => {
  it('keeps the bytes as they were sent, with who set them', async () => {
    const acme = await insertCompany(handle);
    const owner = await insertPrincipal(handle, acme.id);
    const [row] = await logo(acme.id, { updatedByPrincipalId: owner.id });
    expect(row).toMatchObject({
      companyId: acme.id,
      size: 12,
      sha256: hash(PNG),
      updatedByPrincipalId: owner.id,
    });
    const [read] = await handle.db.select().from(companyLogos).where(eq(companyLogos.companyId, acme.id));
    expect(read?.bytes).toBeInstanceOf(Uint8Array);
    expect([...(read?.bytes ?? [])]).toEqual([...PNG]);
  });

  it('holds one logo per company and refuses an unknown company', async () => {
    const acme = await insertCompany(handle);
    await logo(acme.id);
    expect(await pgError(logo(acme.id))).toMatchObject({ code: '23505', constraint: 'company_logos_pkey' });
    expect(await pgError(logo(MISSING_ID))).toMatchObject({
      code: '23503',
      constraint: 'company_logos_company_id_companies_id_fk',
    });
  });

  it('refuses another type, an empty or oversized image and a hash that is not 64 lower-case hex digits', async () => {
    const acme = await insertCompany(handle);
    const checks: [Partial<NewCompanyLogo>, string][] = [
      // @ts-expect-error contentType is typed as LogoContentType; the database refuses it as well
      [{ contentType: 'image/svg+xml' }, 'company_logos_content_type_check'],
      [{ size: 0 }, 'company_logos_size_check'],
      [{ size: 1_048_577 }, 'company_logos_size_check'],
      [{ sha256: hash(PNG).toUpperCase() }, 'company_logos_sha256_check'],
      [{ sha256: 'abc' }, 'company_logos_sha256_check'],
    ];
    for (const [values, constraint] of checks) {
      expect(await pgError(logo(acme.id, values))).toMatchObject({ code: '23514', constraint });
    }
    expect((await logo(acme.id, { size: 1_048_576 }))[0]?.size).toBe(1_048_576);
  });

  it("refuses another company's principal as the one who set it", async () => {
    const acme = await insertCompany(handle);
    const theirs = await insertPrincipal(handle, globex.id);
    expect(await pgError(logo(acme.id, { updatedByPrincipalId: theirs.id }))).toMatchObject({
      code: '23503',
      constraint: 'company_logos_updated_by_principal_fk',
    });
  });

  it('goes with its company when the company row is deleted, and stays while it is only soft-deleted', async () => {
    const kept = await insertCompany(handle);
    await logo(kept.id);
    await handle.db
      .update(companies)
      .set({ status: 'deleted', deletedAt: new Date() })
      .where(eq(companies.id, kept.id));
    expect(
      await handle.db.select().from(companyLogos).where(eq(companyLogos.companyId, kept.id)),
    ).toHaveLength(1);
    const gone = await insertCompany(handle);
    await logo(gone.id);
    await handle.db.delete(companies).where(eq(companies.id, gone.id));
    expect(await handle.db.select().from(companyLogos).where(eq(companyLogos.companyId, gone.id))).toEqual(
      [],
    );
  });
});
