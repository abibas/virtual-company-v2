// @mwc/db/system: raw, unscoped database access, for the code that must see every company: the platform
// (startup, auth, jobs), migrations and scripts, and the identity store (the webhook inbox and the
// projector). Server modules may not import it (biome.json, noRestrictedImports); they reach tenant
// tables through `tenant(db, companyId)` of `@mwc/db`.
export { type CreateDbOptions, createDb, type PostgresDbHandle, type Schema } from './client.ts';
export { type DbHandle, queryRows, type RawDb, type RawDbHandle, rawDb, rawHandle } from './handle.ts';
export { MIGRATIONS_FOLDER, type MigrateOptions, migrateToLatest } from './migrate.ts';
