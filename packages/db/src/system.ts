// @mwc/db/system: raw, unscoped database access, for the code that must see every company: the platform
// (startup, auth, jobs; `reserveSession`, a session of its own, holds the jobs lock), migrations and scripts, and
// the identity store (the webhook inbox and the projector, which writes its audit rows through `tenantOf` in its
// own transaction). Server modules may not import it (biome.json, noRestrictedImports); they reach tenant tables
// through `tenant(db, companyId)` of `@mwc/db`.
export { type CreateDbOptions, createDb, type PostgresDbHandle, type Schema } from './client.ts';
export {
  type DbHandle,
  type DbSession,
  queryRows,
  type RawDb,
  type RawDbHandle,
  rawDb,
  rawHandle,
  reserveSession,
  type SessionParams,
} from './handle.ts';
export { MIGRATIONS_FOLDER, type MigrateOptions, migrateToLatest } from './migrate.ts';
export { tenantOf } from './tenant.ts';
