import { auditLog, contacts, tenant } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { createTestApp, seedCompany, type TestApp } from '@mwc/testkit';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seenOnSlack } from '../../../../src/modules/contacts/index.ts';

/**
 * A Slack person seen (2026-11-14) straight from the service: two messages of one person at once (two Slack connections
 * of one workspace) make one contact, created once; a sighting older than the last one leaves last seen where it was.
 */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const ERICH = {
  teamId: 'T0AIRIA',
  userId: 'U0ERICH',
  name: 'Erich Stuntebeck',
  avatarUrl: null,
  title: null,
  email: null,
  handle: 'erich',
};
const at = (minute: number) => new Date(Date.UTC(2026, 10, 14, 9, minute));

describe('seenOnSlack', () => {
  it('makes one contact for two sightings at once, and audits its creation once', async () => {
    const { company } = await seedCompany(t.db);
    const db = await tenant(t.db, company.id);
    const [a, b] = await Promise.all([seenOnSlack(db, ERICH, at(1)), seenOnSlack(db, ERICH, at(2))]);
    expect(a.id).toBe(b.id);
    const rows = await rawDb(t.db).select().from(contacts).where(eq(contacts.companyId, company.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.lastSeenAt).toEqual(at(2));
    const created = await rawDb(t.db)
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, a.id), eq(auditLog.action, 'create'), eq(auditLog.field, 'name')));
    expect(created).toHaveLength(1);
  });

  it('leaves the row as it was for an older sighting with no name (or only the id), and names a nameless one by id', async () => {
    const { company } = await seedCompany(t.db);
    const db = await tenant(t.db, company.id);
    const first = await seenOnSlack(db, ERICH, at(10));
    expect(await seenOnSlack(db, { ...ERICH, name: '  ', handle: null }, at(5))).toEqual(first);
    expect(await seenOnSlack(db, { ...ERICH, name: 'U0ERICH' }, at(6))).toEqual(first);
    const nameless = await seenOnSlack(db, { ...ERICH, userId: 'U0NONAME', name: 'U0NONAME' }, at(7));
    expect(nameless.name).toBe('U0NONAME');
  });
});
