import { and, eq, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgInsertValue, PgTable, PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { type AuditEntry, auditRows } from './audit.ts';
import { type DbHandle, type RawDb, rawDb } from './handle.ts';
import { type AuditLogRow, auditLog } from './schema/audit-log.ts';
import { isUuid } from './tenant.ts';

/**
 * The personal layer (S3.1): the only way route and service code reaches personal tables, whose rows belong to one
 * person and to no company (`credentials`, `credential_uses`). `owned(db, userId)` returns an `OwnedDb` whose every
 * statement is scoped to that person: reads, updates and deletes get `owner_user_id = <userId>` added to their
 * `where`, and inserts get `owner_user_id` stamped (any value the caller passed is replaced). Like `tenant()`, it
 * lives in `@mwc/db`, so server modules use it without raw access (`@mwc/db/system`); the user id is the signed-in
 * caller's, or the owner a server-side use names, never one read from a request body.
 */

/** A personal table: it has `owner_user_id`. */
export type OwnedTable = PgTable & { readonly ownerUserId: AnyPgColumn };

/** Insert values without `ownerUserId`: the personal layer stamps it. */
export type OwnedValues<T extends OwnedTable> = Omit<T['$inferInsert'], 'ownerUserId'>;

/** Columns to update; `ownerUserId` is not one of them (a row never moves to another person). */
export type OwnedSet<T extends OwnedTable> = Partial<Omit<T['$inferInsert'], 'ownerUserId'>>;

/**
 * A personal change's audit entry. Its rows have no company, so no acting principal: the actor is the owner
 * (`user`, who alone manages their rows; the entity's own rows say whose it is) or the `system` acting for them.
 */
export type OwnedAuditEntry = Omit<AuditEntry, 'actorPrincipalId'>;

class OwnerScopedDb {
  readonly userId: string;
  readonly #db: RawDb;

  constructor(db: RawDb, userId: string) {
    this.#db = db;
    this.userId = userId;
  }

  /** `table.owner_user_id = <userId>`, and `where` when given. */
  scoped(table: OwnedTable, where?: SQL): SQL {
    const own = eq(table.ownerUserId, this.userId);
    return where ? (and(own, where) as SQL) : own;
  }

  /** `select * from table where owner_user_id = … [and where]`; chain `.orderBy()`, `.limit()`. */
  select<T extends OwnedTable>(table: T, where?: SQL) {
    // As in the tenant layer: the table goes in as `never` with T spelled out, and the builder still carries T.
    return this.#db
      .select()
      .from<T>(table as never)
      .where(this.scoped(table, where));
  }

  /** Inserts rows with this person's id stamped; chain `.returning()`. */
  insert<T extends OwnedTable>(table: T, values: OwnedValues<T> | readonly OwnedValues<T>[]) {
    const list: readonly OwnedValues<T>[] = Array.isArray(values) ? values : [values as OwnedValues<T>];
    const rows = list.map((row) => ({ ...row, ownerUserId: this.userId }) as unknown as PgInsertValue<T>);
    return this.#db.insert(table).values(rows);
  }

  /** Updates this person's rows (an `ownerUserId` in `set` is dropped); chain `.returning()`. */
  update<T extends OwnedTable>(table: T, set: OwnedSet<T>, where?: SQL) {
    const { ownerUserId: _kept, ...columns } = set as Record<string, unknown>;
    return this.#db
      .update(table)
      .set(columns as PgUpdateSetSource<T>)
      .where(this.scoped(table, where));
  }

  /** Deletes this person's matching rows; chain `.returning()`. */
  delete<T extends OwnedTable>(table: T, where?: SQL) {
    return this.#db.delete(table).where(this.scoped(table, where));
  }

  /**
   * Writes one `audit_log` row per change, with no company (a personal change belongs to none), in this layer's
   * transaction when it is one; no changes write nothing. Values are jsonb, never a secret: the caller picks them.
   */
  async audit(entry: OwnedAuditEntry): Promise<AuditLogRow[]> {
    if (entry.changes.length === 0) return [];
    return this.#db.insert(auditLog).values(auditRows(entry)).returning();
  }

  /** Runs `work` in one transaction, on the same person's layer (nested: a savepoint). */
  transaction<R>(work: (tx: OwnedDb) => Promise<R>): Promise<R> {
    return this.#db.transaction((tx) => work(new OwnerScopedDb(tx, this.userId)));
  }
}

/** A database scoped to one person (`owned()` makes it; there is no other way to get one). */
export type OwnedDb = OwnerScopedDb;

/** Opens a person's personal layer; throws a `TypeError` for anything but a user id (a bug in the caller). */
export function owned(handle: DbHandle, userId: string): OwnedDb {
  if (!isUuid(userId)) throw new TypeError('owned() takes a user id');
  return new OwnerScopedDb(rawDb(handle), userId);
}
