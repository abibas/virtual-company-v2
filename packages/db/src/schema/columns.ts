import { type SQL, sql } from 'drizzle-orm';
import { type AnyPgColumn, customType, timestamp } from 'drizzle-orm/pg-core';

/**
 * A `bytea` column (Drizzle 0.45 has no built-in one). Both drivers take a `Uint8Array` and give one back
 * (postgres.js a `Buffer`, which is one).
 */
export const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => 'bytea',
});

/** `created_at timestamptz not null default now()`. */
export const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** `updated_at timestamptz not null default now()`; Drizzle also sets it on every update. */
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** The CHECK expression `<column> in ('a', 'b', …)` for an enum mirrored by a zod enum in `@mwc/shared`. */
export function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  return sql`${column} in (${sql.raw(values.map(literal).join(', '))})`;
}
