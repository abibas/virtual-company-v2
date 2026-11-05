// @mwc/db: the schema, the tenant layer and the database checks code anywhere may use. Raw access
// (createDb, migrateToLatest, queryRows, the Drizzle object behind a handle) is `@mwc/db/system`.
export {
  type AuditEntry,
  auditChanges,
  type DiffOptions,
  diffFields,
  type FieldChange,
  sameValue,
} from './audit.ts';
export { type DbHandle, isUniqueViolation, pingDb } from './handle.ts';
export {
  type JournalEntry,
  MIGRATIONS_SCHEMA,
  MIGRATIONS_TABLE,
  type MigrationStatus,
  type MigrationStatusOptions,
  migrationStatus,
  readJournal,
} from './migrate.ts';
export {
  type OwnedAuditEntry,
  type OwnedDb,
  type OwnedSet,
  type OwnedTable,
  type OwnedValues,
  owned,
} from './owned.ts';
export * from './schema/index.ts';
export {
  CompanyNotFoundError,
  type CompanySet,
  isCompanyNotFound,
  isUuid,
  type NewCompanyInput,
  SlugTakenError,
  type TenantDb,
  type TenantSet,
  type TenantTable,
  type TenantValues,
  tenant,
  withNewCompany,
} from './tenant.ts';
