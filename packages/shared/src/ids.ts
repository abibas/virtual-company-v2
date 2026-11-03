import { v7 } from 'uuid';

/**
 * A new row id: a UUID v7 (RFC 9562), generated app-side. Its first 48 bits are the Unix time in
 * milliseconds and ids made in the same millisecond keep increasing, so ids sort by creation
 * time, which keeps btree inserts at the right edge of the index.
 */
export function newId(): string {
  return v7();
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** True for a lower-case UUID v7 string as `newId()` returns. */
export function isId(value: string): boolean {
  return UUID_V7.test(value);
}

/** The creation time encoded in a UUID v7 (its first 48 bits). */
export function idTime(id: string): Date {
  return new Date(Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16));
}
