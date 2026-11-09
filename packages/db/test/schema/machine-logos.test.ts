import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawDbHandle } from '../../src/handle.ts';
import { type Company, machineLogos, machines, type NewMachineLogo } from '../../src/schema/index.ts';
import { pgError, type TestDb } from '../../src/testing.ts';
import {
  insertCompany,
  insertMachine,
  insertPrincipal,
  MISSING_ID,
  migratedTestDb,
} from '../fixtures/rows.ts';

let testDb: TestDb;
let handle: RawDbHandle;
let acme: Company;
let globex: Company;

/** The eight bytes every PNG starts with, and a few more. */
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

beforeAll(async () => {
  testDb = await migratedTestDb();
  handle = testDb.handle;
  acme = await insertCompany(handle);
  globex = await insertCompany(handle);
});
afterAll(() => testDb.close());

function logo(companyId: string, machineId: string, values: Partial<NewMachineLogo> = {}) {
  return handle.db
    .insert(machineLogos)
    .values({
      companyId,
      machineId,
      contentType: 'image/png',
      bytes: PNG,
      size: PNG.length,
      sha256: hash(PNG),
      ...values,
    })
    .returning();
}

const logosOf = (machineId: string) =>
  handle.db.select().from(machineLogos).where(eq(machineLogos.machineId, machineId));

describe('machine_logos', () => {
  it('keeps the bytes as they were sent, with who set them', async () => {
    const mac = await insertMachine(handle, acme.id);
    const admin = await insertPrincipal(handle, acme.id);
    const [row] = await logo(acme.id, mac.id, { updatedByPrincipalId: admin.id });
    expect(row).toMatchObject({
      companyId: acme.id,
      machineId: mac.id,
      size: 12,
      sha256: hash(PNG),
      updatedByPrincipalId: admin.id,
    });
    const [read] = await handle.db
      .select()
      .from(machineLogos)
      .where(and(eq(machineLogos.companyId, acme.id), eq(machineLogos.machineId, mac.id)));
    expect([...(read?.bytes ?? [])]).toEqual([...PNG]);
  });

  it("holds one logo per machine and refuses an unknown machine or another company's", async () => {
    const mac = await insertMachine(handle, acme.id);
    const theirs = await insertMachine(handle, globex.id);
    await logo(acme.id, mac.id);
    expect(await pgError(logo(acme.id, mac.id))).toMatchObject({
      code: '23505',
      constraint: 'machine_logos_pkey',
    });
    for (const machineId of [MISSING_ID, theirs.id]) {
      expect(await pgError(logo(acme.id, machineId))).toMatchObject({
        code: '23503',
        constraint: 'machine_logos_machine_fk',
      });
    }
  });

  it('refuses another type, an empty or oversized image and a hash that is not 64 lower-case hex digits', async () => {
    const mac = await insertMachine(handle, acme.id);
    const checks: [Partial<NewMachineLogo>, string][] = [
      // @ts-expect-error contentType is typed as LogoContentType; the database refuses it as well
      [{ contentType: 'image/svg+xml' }, 'machine_logos_content_type_check'],
      [{ size: 0 }, 'machine_logos_size_check'],
      [{ size: 1_048_577 }, 'machine_logos_size_check'],
      [{ sha256: hash(PNG).toUpperCase() }, 'machine_logos_sha256_check'],
      [{ sha256: 'abc' }, 'machine_logos_sha256_check'],
    ];
    for (const [values, constraint] of checks) {
      expect(await pgError(logo(acme.id, mac.id, values))).toMatchObject({ code: '23514', constraint });
    }
    expect((await logo(acme.id, mac.id, { size: 1_048_576 }))[0]?.size).toBe(1_048_576);
  });

  it("refuses another company's principal as the one who set it", async () => {
    const mac = await insertMachine(handle, acme.id);
    const outsider = await insertPrincipal(handle, globex.id);
    expect(await pgError(logo(acme.id, mac.id, { updatedByPrincipalId: outsider.id }))).toMatchObject({
      code: '23503',
      constraint: 'machine_logos_updated_by_principal_fk',
    });
  });

  it('goes with its machine when the machine row is deleted, and stays while it is only removed', async () => {
    const kept = await insertMachine(handle, acme.id);
    await logo(acme.id, kept.id);
    await handle.db.update(machines).set({ removedAt: new Date() }).where(eq(machines.id, kept.id));
    expect(await logosOf(kept.id)).toHaveLength(1);
    const gone = await insertMachine(handle, acme.id);
    await logo(acme.id, gone.id);
    await handle.db.delete(machines).where(eq(machines.id, gone.id));
    expect(await logosOf(gone.id)).toEqual([]);
  });
});
