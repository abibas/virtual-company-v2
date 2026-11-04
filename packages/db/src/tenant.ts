import { and, eq, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgInsertValue, PgTable, PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { type DbHandle, type RawDb, rawDb } from './handle.ts';
import { type Company, companies } from './schema/companies.ts';

/**
 * The tenant layer: the only way route and service code reaches tenant tables (CLAUDE.md, "Tenant id
 * everywhere"). `tenant(db, companyId)` checks the company once and returns a `TenantDb` whose every
 * statement is scoped to it: reads, updates and deletes get `company_id = <companyId>` added to their
 * `where`, and inserts get `company_id` stamped (any value the caller passed is replaced). Raw access
 * (`@mwc/db/system`) is for the platform, jobs, migrations and the identity store only.
 */

/** A table with a `company_id` column: every tenant table (and the global tables that name a company). */
export type TenantTable = PgTable & { readonly companyId: AnyPgColumn };

/** Insert values without `companyId`: the tenant layer stamps it. */
export type TenantValues<T extends TenantTable> = Omit<T['$inferInsert'], 'companyId'>;

/** Columns to update; `companyId` is not one of them (a row never moves to another company). */
export type TenantSet<T extends TenantTable> = Partial<Omit<T['$inferInsert'], 'companyId'>>;

/** The company is unknown, deleted, or not an id at all: a 404 for the caller, whichever it was. */
export class CompanyNotFoundError extends Error {
  readonly code = 'not_found' as const;
  readonly companyId: string;

  constructor(companyId: string) {
    super(`company ${companyId} not found`);
    this.name = 'CompanyNotFoundError';
    this.companyId = companyId;
  }
}

export function isCompanyNotFound(error: unknown): error is CompanyNotFoundError {
  return error instanceof CompanyNotFoundError;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a UUID string of any version, as Postgres' `uuid` type accepts it (lookups skip anything else). */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

class ScopedDb {
  readonly companyId: string;
  /** The company as it was when the tenant was opened. */
  readonly company: Company;
  readonly #db: RawDb;

  constructor(db: RawDb, company: Company) {
    this.#db = db;
    this.company = company;
    this.companyId = company.id;
  }

  /** `table.company_id = <companyId>`, and `where` when given: for joins and hand-built queries. */
  scoped(table: TenantTable, where?: SQL): SQL {
    const own = eq(table.companyId, this.companyId);
    return where ? (and(own, where) as SQL) : own;
  }

  /** `select * from table where company_id = … [and where]`; chain `.orderBy()`, `.limit()`. */
  select<T extends TenantTable>(table: T, where?: SQL) {
    // The table goes in as `never` with T spelled out: Drizzle's check that a table has columns cannot run on
    // an unresolved T, and the builder still carries T, so callers get their table's row type.
    return this.#db
      .select()
      .from<T>(table as never)
      .where(this.scoped(table, where));
  }

  /** Inserts rows with this company's id stamped; chain `.returning()`, `.onConflictDoNothing()`. */
  insert<T extends TenantTable>(table: T, values: TenantValues<T> | readonly TenantValues<T>[]) {
    const list: readonly TenantValues<T>[] = Array.isArray(values) ? values : [values as TenantValues<T>];
    const rows = list.map((row) => ({ ...row, companyId: this.companyId }) as unknown as PgInsertValue<T>);
    return this.#db.insert(table).values(rows);
  }

  /** Updates this company's rows (a `companyId` in `set` is dropped); chain `.returning()`. */
  update<T extends TenantTable>(table: T, set: TenantSet<T>, where?: SQL) {
    const { companyId: _kept, ...columns } = set as Record<string, unknown>;
    return this.#db
      .update(table)
      .set(columns as PgUpdateSetSource<T>)
      .where(this.scoped(table, where));
  }

  /** Deletes this company's matching rows; chain `.returning()`. */
  delete<T extends TenantTable>(table: T, where?: SQL) {
    return this.#db.delete(table).where(this.scoped(table, where));
  }

  /** Runs `work` in one transaction, on a tenant of the same company (nested: a savepoint). */
  transaction<R>(work: (tx: TenantDb) => Promise<R>): Promise<R> {
    return this.#db.transaction((tx) => work(new ScopedDb(tx, this.company)));
  }
}

/** A database scoped to one company (`tenant()` makes it; there is no other way to get one). */
export type TenantDb = ScopedDb;

/**
 * Opens a company's tenant. Refuses, with `CompanyNotFoundError`, a company that does not exist, is
 * deleted (`status = 'deleted'` or `deleted_at` set), or is not an id at all.
 */
export async function tenant(handle: DbHandle, companyId: string): Promise<TenantDb> {
  if (!isUuid(companyId)) throw new CompanyNotFoundError(companyId);
  const db = rawDb(handle);
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company || company.status === 'deleted' || company.deletedAt !== null) {
    throw new CompanyNotFoundError(companyId);
  }
  return new ScopedDb(db, company);
}
