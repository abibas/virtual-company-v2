// The credentials module: people's own subscriptions, API keys and gateways, sealed under the master key (S3.1), and
// Sign in with Claude and with OpenAI (S3.2). createApp mounts its routers; the steps after it use the internal
// service (storeCredential, useCredentialSecret), and the chats module opens subscriptions for its turns and terminals
// (credentialsForHarness, S5.1b).

export { signInRoutes } from './routes/sign-in.ts';
export { credentialsRoutes } from './routes.ts';
export {
  type CredentialsForHarness,
  credentialsForHarness,
  type HarnessDeps,
  type HarnessRefusal,
  type HarnessUse,
} from './service/harness.ts';
export {
  type CredentialSecrets,
  credentialSecrets,
  type SecretDeps,
  type StoreCredentialInput,
  type UsedCredential,
} from './service/secrets.ts';
export { providerFetchFor } from './service/usage/http.ts';
