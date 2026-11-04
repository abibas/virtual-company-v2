import type { ActorKind } from '@mwc/shared/enums';
import { type AuditLogRow, auditLog } from './schema/audit-log.ts';
import type { TenantDb } from './tenant.ts';

/** One audit row's worth of change: a field and its value before and after (null when absent). */
export interface FieldChange {
  readonly field: string;
  readonly old: unknown;
  readonly new: unknown;
}

export interface DiffOptions {
  /** Fields never reported, such as `updatedAt`, which changes on every write. */
  readonly ignore?: readonly string[];
}

type Row = Readonly<Record<string, unknown>> | null | undefined;

/**
 * The fields that differ between two versions of a row, sorted by name, for the per-field
 * `audit_log` rows. A missing row (create or delete) counts as having no fields; an absent field
 * and an `undefined` one are the same and are reported as null. Values compare by value, so
 * jsonb objects with the same content in another key order are equal, and dates by their time.
 */
export function diffFields(before: Row, after: Row, options: DiffOptions = {}): FieldChange[] {
  const ignore = new Set(options.ignore);
  const fields = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changes: FieldChange[] = [];
  for (const field of [...fields].sort()) {
    if (ignore.has(field)) continue;
    const oldValue = before?.[field] ?? null;
    const newValue = after?.[field] ?? null;
    if (!sameValue(oldValue, newValue)) changes.push({ field, old: oldValue, new: newValue });
  }
  return changes;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Deep equality as jsonb sees it: key order does not matter, `undefined` members are absent. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a).filter((key) => a[key] !== undefined);
    const keysB = Object.keys(b).filter((key) => b[key] !== undefined);
    return keysA.length === keysB.length && keysA.every((key) => key in b && sameValue(a[key], b[key]));
  }
  return false;
}

/** Who changed which entity, how, and what: the rows `auditChanges` writes, one per field change. */
export interface AuditEntry {
  readonly actorKind: ActorKind;
  /** The acting principal, of the tenant's company; none for the system or the identity provider. */
  readonly actorPrincipalId?: string | null;
  /** The request that made the change (`x-request-id`); none for a background job. */
  readonly requestId?: string | null;
  readonly entityType: string;
  readonly entityId: string;
  /** `create`, `update`, `delete`, ... */
  readonly action: string;
  /** Usually `diffFields(before, after)`. */
  readonly changes: readonly FieldChange[];
}

/**
 * Writes one `audit_log` row per change into the tenant's company (in the tenant's transaction when it is one)
 * and returns them; no changes write nothing. Values are stored as jsonb (a date as its ISO string).
 */
export async function auditChanges(t: TenantDb, entry: AuditEntry): Promise<AuditLogRow[]> {
  if (entry.changes.length === 0) return [];
  const rows = entry.changes.map((change) => ({
    actorKind: entry.actorKind,
    actorPrincipalId: entry.actorPrincipalId ?? null,
    requestId: entry.requestId ?? null,
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    field: change.field,
    oldValue: change.old,
    newValue: change.new,
  }));
  return t.insert(auditLog, rows).returning();
}
