/**
 * Test databases. The implementation lives in `@mwc/db/testing` (the db package's own tests use it
 * without depending on the testkit); everything else imports it from here.
 */
export { createTestDb, pgError, type TestDb, type TestDbKind, testDbKind } from '@mwc/db/testing';
