// @mwc/testkit: what S1+ tests need, from one import (a devDependency of the packages that use it).
// Usage and the lanes: docs/testing.md.

// The identity test doubles (S1.1): an in-memory IdentityProvider with `fake:<subject>` tokens,
// accept(), drainEvents(), failNext() and signed fake webhooks, and the in-memory IdentityStore.
export {
  type AcceptOptions,
  FAKE_ISSUER,
  FAKE_ROLES,
  FAKE_SIGNATURE_HEADER,
  FakeIdentityProvider,
  type FakeIdentityProviderOptions,
  type FakeMethod,
  type FakeUserInput,
} from '@mwc/identity-core/fake';
export { InMemoryIdentityStore } from '@mwc/identity-core/memory-store';
export {
  type App,
  brokenDb,
  createTestApp,
  TEST_VERSION,
  type TestApp,
  type TestAppOptions,
  testConfig,
} from './app.ts';
export { fixedClock, TEST_NOW, type TestClock } from './clock.ts';
export { createTestDb, pgError, type TestDb, type TestDbKind, testDbKind } from './db.ts';
export {
  getJson,
  type JsonRequest,
  type JsonResponse,
  postJson,
  type Requestable,
  requestJson,
} from './http.ts';
export { captureLogger, LEVEL, type LogLine } from './logger.ts';

// Extension points, one per S1 step (each arrives with the code it tests):
// - S1.2 signedWebhook(event, secret): a svix-signed Clerk webhook request for POST /api/webhooks/clerk.
// - S1.3 seedCompany(db, ...): a company with its owner user, principal and membership, through the
//   tenant layer, so route tests start from a real tenant in one line.
