import { type SQL, sql } from 'drizzle-orm';
import { type AnyPgColumn, timestamp } from 'drizzle-orm/pg-core';

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
