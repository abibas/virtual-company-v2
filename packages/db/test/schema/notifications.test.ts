import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawDbHandle } from '../../src/handle.ts';
import {
  type Company,
  type NewNotification,
  type Notification,
  notificationSettings,
  notifications,
  type Principal,
} from '../../src/schema/index.ts';
import { pgError, type TestDb } from '../../src/testing.ts';
import { insertCompany, insertPrincipal, MISSING_ID, migratedTestDb } from '../fixtures/rows.ts';

let testDb: TestDb;
let handle: RawDbHandle;
let acme: Company;
let globex: Company;
let person: Principal;
let actor: Principal;

beforeAll(async () => {
  testDb = await migratedTestDb();
  handle = testDb.handle;
  acme = await insertCompany(handle);
  globex = await insertCompany(handle);
  person = await insertPrincipal(handle, acme.id);
  actor = await insertPrincipal(handle, acme.id);
});
afterAll(() => testDb.close());

const constraint = async (work: Promise<unknown>) => (await pgError(work)).constraint;

async function insertNotification(values: Partial<NewNotification> = {}): Promise<Notification> {
  const [row] = await handle.db
    .insert(notifications)
    .values({ companyId: acme.id, recipientPrincipalId: person.id, kind: 'manager_changed', ...values })
    .returning();
  if (!row) throw new Error('no notification returned');
  return row;
}

describe('notifications', () => {
  it('stores a notification unread, its email pending and untried', async () => {
    expect(await insertNotification({ actorPrincipalId: actor.id, payload: { to: actor.id } })).toMatchObject(
      {
        payload: { to: actor.id },
        readAt: null,
        emailStatus: 'pending',
        emailQueuedAt: null,
        emailNextAt: null,
        emailAttempts: 0,
        emailedAt: null,
        emailError: null,
      },
    );
    expect((await insertNotification()).actorPrincipalId).toBeNull();
  });

  it('refuses an unknown kind or email status, a payload that is not an object and negative tries', async () => {
    expect(await constraint(insertNotification({ kind: 'hired' as never }))).toBe('notifications_kind_check');
    expect(await constraint(insertNotification({ emailStatus: 'queued' as never }))).toBe(
      'notifications_email_status_check',
    );
    expect(await constraint(insertNotification({ payload: [] as never }))).toBe(
      'notifications_payload_check',
    );
    expect(await constraint(insertNotification({ emailAttempts: -1 }))).toBe(
      'notifications_email_attempts_check',
    );
  });

  it("refuses another company's recipient or actor (composite keys)", async () => {
    const theirs = await insertPrincipal(handle, globex.id);
    expect(await constraint(insertNotification({ recipientPrincipalId: theirs.id }))).toBe(
      'notifications_recipient_fk',
    );
    expect(await constraint(insertNotification({ actorPrincipalId: MISSING_ID }))).toBe(
      'notifications_actor_fk',
    );
  });
});

describe('notification_settings', () => {
  it('keeps one row per principal, email on by default', async () => {
    const [row] = await handle.db
      .insert(notificationSettings)
      .values({ companyId: acme.id, principalId: actor.id })
      .returning();
    expect(row).toMatchObject({ email: true });
    const again = handle.db
      .insert(notificationSettings)
      .values({ companyId: acme.id, principalId: actor.id });
    expect(await constraint(again)).toBe('notification_settings_company_id_principal_id_pk');
    await handle.db
      .update(notificationSettings)
      .set({ email: false })
      .where(
        and(eq(notificationSettings.companyId, acme.id), eq(notificationSettings.principalId, actor.id)),
      );
    const [after] = await handle.db
      .select()
      .from(notificationSettings)
      .where(eq(notificationSettings.principalId, actor.id));
    expect(after?.email).toBe(false);
  });

  it("refuses another company's principal", async () => {
    const theirs = await insertPrincipal(handle, globex.id);
    const insert = handle.db
      .insert(notificationSettings)
      .values({ companyId: acme.id, principalId: theirs.id });
    expect(await constraint(insert)).toBe('notification_settings_principal_fk');
  });
});
