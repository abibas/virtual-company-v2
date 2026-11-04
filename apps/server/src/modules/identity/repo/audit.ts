import { auditChanges, isCompanyNotFound, type TenantDb } from '@mwc/db';
import { type RawDb, tenantOf } from '@mwc/db/system';
import type { ProjectionChange } from '@mwc/identity-core';

/**
 * The audit rows of a projection: one per changed field of each membership and invitation it changed, by the
 * system, with the provider event's id as the request id, written through the tenant layer's `auditChanges` on the
 * projection's own transaction (so they commit or roll back with it). Users are global rows (no company to log in)
 * and the notes (ignored, deferred, refused) change nothing, so neither is logged. A company deleted here keeps no
 * new audit rows: its tenant is gone.
 */

const LOGGED: ReadonlySet<ProjectionChange['entity']> = new Set(['membership', 'invitation']);

/** The audit action of a projected change: `activate`, `update`, `remove`, `accept`, `revoke`, ... */
export function auditAction(change: ProjectionChange): string | undefined {
  switch (change.action) {
    case 'created': {
      const status = change.fields.find((field) => field.field === 'status')?.new;
      return status === 'active' ? 'activate' : 'create';
    }
    case 'reactivated':
      return 'activate';
    case 'updated':
      return 'update';
    case 'removed':
      return 'remove';
    case 'accepted':
      return 'accept';
    case 'revoked':
      return 'revoke';
    default:
      return undefined;
  }
}

/** Writes the audit rows of `changes` on `db` (the projection's transaction); resolves the number of rows. */
export async function auditProjection(
  db: RawDb,
  changes: readonly ProjectionChange[],
  requestId: string,
): Promise<number> {
  const tenants = new Map<string, TenantDb | null>();
  let written = 0;
  for (const change of changes) {
    const action = auditAction(change);
    if (!LOGGED.has(change.entity) || action === undefined || change.id === null || change.companyId === null)
      continue;
    const t = await tenantFor(db, change.companyId, tenants);
    if (t === null) continue;
    const rows = await auditChanges(t, {
      actorKind: 'system',
      requestId,
      entityType: change.entity,
      entityId: change.id,
      action,
      // Sorted by field, as `diffFields` reports the other audit rows.
      changes: [...change.fields].sort((a, b) => a.field.localeCompare(b.field)),
    });
    written += rows.length;
  }
  return written;
}

async function tenantFor(db: RawDb, companyId: string, tenants: Map<string, TenantDb | null>) {
  if (!tenants.has(companyId)) {
    try {
      tenants.set(companyId, await tenantOf(db, companyId));
    } catch (error) {
      if (!isCompanyNotFound(error)) throw error;
      tenants.set(companyId, null);
    }
  }
  return tenants.get(companyId) ?? null;
}
