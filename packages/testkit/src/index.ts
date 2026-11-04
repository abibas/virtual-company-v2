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
// The IdentityProvider contract (S1.2): one scenario every provider passes, run against the fake always
// and against the real Clerk dev instance on request (connectors/identity-clerk, docs/clerk-setup.md).
// Also importable alone, without the server: @mwc/testkit/provider-contract.
export {
  type AcceptResult,
  CONTRACT_WEB_ORIGIN,
  type ContractCase,
  type ContractState,
  type ContractTarget,
  describeProviderContract,
  fakeContractTarget,
  PROVIDER_CONTRACT,
  type ProviderContractOptions,
} from './provider-contract.ts';
// svix-signed webhook deliveries (S1.2), as Clerk sends them; also @mwc/testkit/webhooks.
export {
  type SignedWebhook,
  type SignedWebhookOptions,
  SVIX_ID_HEADER,
  SVIX_SIGNATURE_HEADER,
  SVIX_TIMESTAMP_HEADER,
  signedWebhook,
  svixSignature,
  testWebhookSecret,
} from './webhooks.ts';

// Extension points, one per S1 step (each arrives with the code it tests):
// - S1.3 seedCompany(db, ...): a company with its owner user, principal and membership, through the
//   tenant layer, so route tests start from a real tenant in one line.
