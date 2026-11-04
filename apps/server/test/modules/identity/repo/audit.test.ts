import { auditLog } from '@mwc/db';
import { migrateToLatest, type RawDb, rawDb } from '@mwc/db/system';
import type { ProjectionAction, ProjectionChange } from '@mwc/identity-core';
import { createTestDb, seedCompany, type TestDb } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditAction, auditProjection } from '../../../../src/modules/identity/repo/audit.ts';

let testDb: TestDb;
let companyId: string;
beforeAll(async () => {
  testDb = await createTestDb();
  await migrateToLatest(testDb.handle);
  companyId = (await seedCompany(testDb.handle)).company.id;
});
afterAll(() => testDb.close());

const change = (patch: Partial<ProjectionChange> = {}): ProjectionChange => ({
  entity: 'membership',
  action: 'updated',
  id: '019a4f0c-8c1e-7c4b-9a52-3d1f2b6e7a10',
  companyId,
  fields: [{ field: 'role', old: 'member', new: 'admin' }],
  reason: null,
  eventId: 'evt_1',
  ...patch,
});
const rowsOf = (requestId: string) =>
  rawDb(testDb.handle).select().from(auditLog).where(eq(auditLog.requestId, requestId));

describe('auditAction', () => {
  it('names each change that changed something, and nothing for the notes', () => {
    const active = [{ field: 'status', old: null, new: 'active' }];
    const removed = [{ field: 'status', old: null, new: 'removed' }];
    expect(auditAction(change({ action: 'created', fields: active }))).toBe('activate');
    expect(auditAction(change({ action: 'created', fields: removed }))).toBe('create');
    const named: [ProjectionAction, string | undefined][] = [
      ['reactivated', 'activate'],
      ['updated', 'update'],
      ['removed', 'remove'],
      ['accepted', 'accept'],
      ['revoked', 'revoke'],
      ['deactivated', undefined],
      ['ignored', undefined],
      ['deferred', undefined],
      ['refused', undefined],
    ];
    for (const [action, expected] of named) expect(auditAction(change({ action }))).toBe(expected);
  });
});

describe('auditProjection', () => {
  it('writes the membership and invitation changes of a company, by the system, and skips the rest', async () => {
    const changes = [
      change({
        fields: [{ field: 'status', old: 'active', new: 'removed' }, ...change().fields],
        action: 'removed',
      }),
      change({
        entity: 'invitation',
        action: 'accepted',
        fields: [{ field: 'status', old: 'pending', new: 'accepted' }],
      }),
      change({ entity: 'user', companyId: null }),
      change({ action: 'ignored' }),
      change({ id: null }),
      change({ companyId: null }),
      change({ companyId: 'not-a-company' }),
      change({ companyId: '019a4f0c-8c1e-7c4b-9a52-3d1f2b6e7a99' }),
    ];
    expect(await auditProjection(rawDb(testDb.handle), changes, 'evt_audit')).toBe(3);
    const rows = await rowsOf('evt_audit');
    expect(rows.map((row) => [row.entityType, row.action, row.field])).toEqual([
      ['membership', 'remove', 'role'],
      ['membership', 'remove', 'status'],
      ['invitation', 'accept', 'status'],
    ]);
    for (const row of rows)
      expect(row).toMatchObject({ companyId, actorKind: 'system', actorPrincipalId: null });
  });

  it('lets a database failure through', async () => {
    const broken = {
      select: () => {
        throw new Error('database down');
      },
    } as unknown as RawDb;
    await expect(auditProjection(broken, [change()], 'evt_broken')).rejects.toThrow('database down');
    expect(await rowsOf('evt_broken')).toEqual([]);
  });
});
