import { and, eq, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgInsertValue, PgTable, PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { type DbHandle, type RawDb, rawDb } from './handle.ts';
import { type Company, companies } from './schema/companies.ts';

/**
 * The tenant layer: the only way route and service code reaches tenant tables (CLAUDE.md, "Tenant id
 * everywhere"). `tenant(db, companyId)` checks the company once and returns a `TenantDb` whose every
 * statement is scoped to it: reads, updates and deletes get `company_id = <companyId>` added to their
 * `where`, and inserts get `company_id` stamped (any value the caller passed is replaced); the company row itself
 * is updated and locked through `updateCompany` and `lockCompany`. `withNewCompany` creates a company and hands
 * its tenant in the same transaction. Raw access (`@mwc/db/system`) is for the platform, jobs, migrations and the
 * identity store only.
 */

/** A table with a `company_id` column: every tenant table (and the global tables that name a company). */
export type TenantTable = PgTable & { readonly companyId: AnyPgColumn };

/** Insert values without `companyId`: the tenant layer stamps it. */
export type TenantValues<T extends TenantTable> = Omit<T['$inferInsert'], 'companyId'>;

/** Columns to update; `companyId` is not one of them (a row never moves to another company). */
export type TenantSet<T extends TenantTable> = Partial<Omit<T['$inferInsert'], 'companyId'>>;

/** Columns of the company row itself to update, as values or SQL; its `id` never changes. */
export type CompanySet = Omit<PgUpdateSetSource<typeof companies>, 'id' | 'createdAt'>;

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

/** No slug of the list was free: every one of them belongs to another company. */
export class SlugTakenError extends Error {
  readonly code = 'slug_taken' as const;
  readonly slugs: readonly string[];

  constructor(slugs: readonly string[]) {
    super(`every slug is taken: ${slugs.join(', ')}`);
    this.name = 'SlugTakenError';
    this.slugs = slugs;
  }
}

const isDeleted = (company: Company) => company.status === 'deleted' || company.deletedAt !== null;

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

  /**
   * Updates the company row itself (its name, slug, status, provider link, ...), and only when `where` holds too;
   * chain `.returning()`. `company` keeps the row as it was when the tenant was opened.
   */
  updateCompany(set: CompanySet, where?: SQL) {
    const { id: _kept, ...columns } = set as Record<string, unknown>;
    const own = eq(companies.id, this.companyId);
    return this.#db
      .update(companies)
      .set(columns as PgUpdateSetSource<typeof companies>)
      .where(where ? and(own, where) : own);
  }

  /**
   * The company row as it is now, locked (`for update`) until the transaction ends, so a read-then-write in
   * `transaction()` sees no concurrent change. Refuses a company deleted since the tenant was opened.
   */
  async lockCompany(): Promise<Company> {
    const [row] = await this.#db
      .select()
      .from(companies)
      .where(eq(companies.id, this.companyId))
      .for('update');
    if (!row || isDeleted(row)) throw new CompanyNotFoundError(this.companyId);
    return row;
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
export function tenant(handle: DbHandle, companyId: string): Promise<TenantDb> {
  return tenantOf(rawDb(handle), companyId);
}

/**
 * `tenant()` on a raw database, or on a transaction already open on one: its statements run in that transaction.
 * For system code that holds raw access (`@mwc/db/system` exports it), such as the identity store writing the audit
 * rows of a projection in the projection's own transaction. The same refusals as `tenant()`.
 */
export async function tenantOf(db: RawDb, companyId: string): Promise<TenantDb> {
  if (!isUuid(companyId)) throw new CompanyNotFoundError(companyId);
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company || isDeleted(company)) throw new CompanyNotFoundError(companyId);
  return new ScopedDb(db, company);
}

/** A new company as `withNewCompany` inserts it (status `provisioning`, the column default). */
export interface NewCompanyInput {
  readonly name: string;
  /** The slugs to try, in order: the company takes the first one no other company has. */
  readonly slugs: readonly string[];
  readonly createdByUserId?: string | null;
  /** The identity provider's kind (`clerk`, `fake`); the column default when omitted. */
  readonly identityProvider?: string | undefined;
}

/**
 * Creates a company and runs `work` on a tenant bound to it, in one transaction: the global row and its first
 * tenant rows (the creator's principal and membership, an outbox row, audit rows) land together or not at all,
 * and `work` throwing rolls the company back too. It is the only way to write a company's row and its tenant rows
 * in one transaction without `@mwc/db/system`. Each slug is tried with `on conflict do nothing`, so one taken
 * meanwhile by a concurrent create moves on to the next instead of aborting the transaction; when none is free it
 * rejects with `SlugTakenError`.
 */
export function withNewCompany<R>(
  handle: DbHandle,
  input: NewCompanyInput,
  work: (t: TenantDb) => Promise<R>,
): Promise<R> {
  return rawDb(handle).transaction(async (tx) => {
    for (const slug of input.slugs) {
      const [company] = await tx
        .insert(companies)
        .values({
          name: input.name,
          slug,
          createdByUserId: input.createdByUserId ?? null,
          ...(input.identityProvider === undefined ? {} : { identityProvider: input.identityProvider }),
        })
        .onConflictDoNothing({ target: companies.slug })
        .returning();
      if (company) return work(new ScopedDb(tx, company));
    }
    throw new SlugTakenError(input.slugs);
  });
}
