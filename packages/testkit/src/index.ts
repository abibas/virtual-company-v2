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
// A company with its owner (user, identity, principal, owner membership) in one line (S1.3), the tenant
// rows through the tenant layer.
export { type SeedCompanyOptions, type SeededCompany, seedCompany } from './seed.ts';
// The IdentityStore contract (S1.3): the port, the projector's convergence and reconcile on a store, run
// against the in-memory store here and against the database store in @mwc/server. Also importable alone,
// without the server: @mwc/testkit/store-contract.
export {
  describeStoreContract,
  FULL_SETTINGS,
  type IdentitySnapshot,
  memorySeedableStore,
  memoryStoreTarget,
  type SeedableStore,
  STORE_CONTRACT,
  type StoreContractCase,
  type StoreContractOptions,
  type StoreContractSettings,
  type StoreContractTarget,
} from './store-contract.ts';
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
