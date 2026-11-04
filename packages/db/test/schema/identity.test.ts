import type { NormalizedIdentityEvent } from '@mwc/shared/identity';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawDbHandle } from '../../src/handle.ts';
import {
  type Company,
  identityEvents,
  identityMarks,
  identityOutbox,
  identityParkedEvents,
  type NewIdentityEventRow,
  type NewIdentityOutboxRow,
} from '../../src/schema/index.ts';
import { pgError, type TestDb } from '../../src/testing.ts';
import { insertCompany, MISSING_ID, migratedTestDb, unique } from '../fixtures/rows.ts';

let testDb: TestDb;
let handle: RawDbHandle;
let acme: Company;

beforeAll(async () => {
  testDb = await migratedTestDb();
  handle = testDb.handle;
  acme = await insertCompany(handle);
});
afterAll(() => testDb.close());

const deleted = (id: string): NormalizedIdentityEvent => ({
  provider: 'clerk',
  externalEventId: id,
  occurredAt: 1_762_171_200_123,
  type: 'user.deleted',
  data: { subject: 'user_1' },
});

function event(values: Partial<NewIdentityEventRow> = {}) {
  const externalEventId = values.externalEventId ?? unique('msg');
  return handle.db
    .insert(identityEvents)
    .values({
      provider: 'clerk',
      externalEventId,
      type: 'user.deleted',
      occurredAt: new Date(1_762_171_200_123),
      payload: deleted(externalEventId),
      ...values,
    })
    .returning();
}

function outbox(values: Partial<NewIdentityOutboxRow> = {}) {
  return handle.db
    .insert(identityOutbox)
    .values({ companyId: acme.id, op: 'create_org', idempotencyKey: unique('create_org'), ...values })
    .returning();
}

describe('identity_events', () => {
  it('stores a delivery as pending, never tried, with its normalized event', async () => {
    const [row] = await event();
    expect(row).toMatchObject({ status: 'pending', attempts: 0, lastError: null, nextAttemptAt: null });
    expect(row?.payload).toEqual(deleted(row?.externalEventId ?? ''));
    expect(row?.occurredAt.getTime()).toBe(1_762_171_200_123);
  });

  it('deduplicates on (provider, external_event_id)', async () => {
    const externalEventId = unique('msg');
    await event({ externalEventId });
    expect(await pgError(event({ externalEventId }))).toMatchObject({
      code: '23505',
      constraint: 'identity_events_provider_external_event_id_unique',
    });
    await expect(event({ externalEventId, provider: 'oidc' })).resolves.toHaveLength(1);
  });

  it.each([
    [{ type: 'user.renamed' }, 'identity_events_type_check'],
    [{ status: 'done' }, 'identity_events_status_check'],
    [{ attempts: -1 }, 'identity_events_attempts_check'],
  ] as const)('refuses %j', async (values, constraint) => {
    expect(await pgError(event(values as Partial<NewIdentityEventRow>))).toMatchObject({
      code: '23514',
      constraint,
    });
  });
});

describe('identity_outbox', () => {
  it('stores a call as pending and due now', async () => {
    const [row] = await outbox({ op: 'invite', payload: { invitationId: 'i1' } });
    expect(row).toMatchObject({
      op: 'invite',
      status: 'pending',
      attempts: 0,
      payload: { invitationId: 'i1' },
    });
    expect(row?.nextAttemptAt).toBeInstanceOf(Date);
    expect(row?.completedAt).toBeNull();
  });

  it('refuses the same idempotency key twice and an unknown company', async () => {
    const idempotencyKey = unique('invite');
    await outbox({ idempotencyKey });
    expect(await pgError(outbox({ idempotencyKey }))).toMatchObject({
      code: '23505',
      constraint: 'identity_outbox_idempotency_key_unique',
    });
    expect(await pgError(outbox({ companyId: MISSING_ID }))).toMatchObject({
      code: '23503',
      constraint: 'identity_outbox_company_id_companies_id_fk',
    });
  });

  it.each([
    [{ op: 'send_email' }, 'identity_outbox_op_check'],
    [{ status: 'processed' }, 'identity_outbox_status_check'],
    [{ attempts: -2 }, 'identity_outbox_attempts_check'],
  ] as const)('refuses %j', async (values, constraint) => {
    expect(await pgError(outbox(values as Partial<NewIdentityOutboxRow>))).toMatchObject({
      code: '23514',
      constraint,
    });
  });
});

describe('identity_marks and identity_parked_events', () => {
  it('keeps a mark per key with an exact millisecond time beyond 32 bits', async () => {
    const [row] = await handle.db
      .insert(identityMarks)
      .values({ key: unique('user:iss|sub'), providerUpdatedAtMs: 1_762_171_200_123 })
      .returning();
    expect(row).toMatchObject({ providerUpdatedAtMs: 1_762_171_200_123, deleted: false });
    const again = handle.db.insert(identityMarks).values({ key: row?.key ?? '' });
    expect((await pgError(again)).code).toBe('23505');
  });

  it('parks an event once per key, in order', async () => {
    const key = unique('org:org_1');
    const rows = await handle.db
      .insert(identityParkedEvents)
      .values([
        { key, externalEventId: 'e1', event: deleted('e1') },
        { key, externalEventId: 'e2', event: deleted('e2') },
      ])
      .returning();
    expect((rows[1]?.id ?? 0) > (rows[0]?.id ?? 0)).toBe(true);
    expect(rows[0]?.event).toEqual(deleted('e1'));
    const twice = handle.db
      .insert(identityParkedEvents)
      .values({ key, externalEventId: 'e1', event: deleted('e1') });
    expect(await pgError(twice)).toMatchObject({
      code: '23505',
      constraint: 'identity_parked_events_key_event_unique',
    });
  });
});
