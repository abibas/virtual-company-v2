import { newId } from '@mwc/shared/ids';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { queryRows, type RawDbHandle } from '../../src/handle.ts';
import { migrateToLatest } from '../../src/migrate.ts';
import { auditLog, type Company, flows } from '../../src/schema/index.ts';
import { createTestDb, type TestDb, testDbKind } from '../../src/testing.ts';
import { migrateUpTo } from '../fixtures/migrations.ts';
import { insertCompany, insertPrincipal } from '../fixtures/rows.ts';

/**
 * The data step of migration `0027_lead_check_ins` (the `-- custom:` part of `migrations/0027_lead_check_ins.sql`): a
 * flow's check-ins count toward its caps on wake-ups, so the caps' defaults rose from 6 an hour and 40 a day to 12 and
 * 150, and a flow still at an old default takes the new one; a cap set to anything else keeps it. Each change is
 * audited by the system. Every flow gets a check-in every 5 minutes (the new column's default). The rows are seeded at
 * `0026_chat_machine_waits`, with the columns `flows` had then.
 */

const BY = 'migration:0027_lead_check_ins';
let testDb: TestDb;
let handle: RawDbHandle;
let company: Company;

beforeAll(async () => {
  testDb = await createTestDb();
  handle = testDb.handle;
  await migrateUpTo(handle, '0026_chat_machine_waits');
  company = await insertCompany(handle);
});
afterAll(() => testDb.close());

/** A flow with these caps, written with the columns `flows` had at `0026`. */
async function flowAt0026(name: string, perHour: number, perDay: number): Promise<string> {
  const lead = await insertPrincipal(handle, company.id);
  const id = newId();
  await queryRows(
    handle,
    sql`insert into flows (id, company_id, lead_principal_id, name, created_by, wake_max_per_hour, wake_max_per_day)
        values (${id}, ${company.id}, ${lead.id}, ${name}, ${lead.id}, ${perHour}, ${perDay})`,
  );
  return id;
}

describe(`0027_lead_check_ins on ${testDbKind()}: the caps' new defaults and the check-ins`, () => {
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ids.defaults = await flowAt0026('Defaults', 6, 40);
    ids.custom = await flowAt0026('Custom', 3, 90);
    ids.hourOnly = await flowAt0026('Hour only', 6, 25);
    await migrateToLatest(handle);
  });

  const caps = async (id: string | undefined) => {
    const [row] = await handle.db
      .select()
      .from(flows)
      .where(eq(flows.id, id as string));
    return { hour: row?.wakeMaxPerHour, day: row?.wakeMaxPerDay, checkIn: row?.wakeCheckInMinutes };
  };

  it('moves the caps still at the old defaults to the new ones, and keeps the others', async () => {
    expect(await caps(ids.defaults)).toEqual({ hour: 12, day: 150, checkIn: 5 });
    expect(await caps(ids.custom)).toEqual({ hour: 3, day: 90, checkIn: 5 });
    expect(await caps(ids.hourOnly)).toEqual({ hour: 12, day: 25, checkIn: 5 });
  });

  it('audits each value it changed, by the system', async () => {
    const rows = await handle.db.select().from(auditLog).where(eq(auditLog.requestId, BY));
    const seen = rows
      .map((row) => `${row.entityId}:${row.field}:${String(row.oldValue)}->${String(row.newValue)}`)
      .sort();
    expect(seen).toEqual(
      [
        `${ids.defaults}:wakeMaxPerDay:40->150`,
        `${ids.defaults}:wakeMaxPerHour:6->12`,
        `${ids.hourOnly}:wakeMaxPerHour:6->12`,
      ].sort(),
    );
    for (const row of rows) {
      expect(row).toMatchObject({ companyId: company.id, actorKind: 'system', entityType: 'flow' });
    }
  });
});
