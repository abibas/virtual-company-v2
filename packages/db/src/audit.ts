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
