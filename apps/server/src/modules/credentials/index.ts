// The credentials module: people's own subscriptions, API keys and gateways, sealed under the master key (S3.1),
// Sign in with Claude and with OpenAI (S3.2), and the tool sign-ins (S7.1a: GitHub, Atlassian) with their daily check
// for the jobs loop (toolCheckJob). createApp mounts its routers; the steps after it use the internal
// service (storeCredential, useCredentialSecret), and the chats module opens subscriptions for its turns and terminals
// (credentialsForHarness, S5.1b); the integrations module opens tool sign-ins for the agents' tools (credentialsForTools,
// S7.1c).

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
export { type CredentialsForTools, credentialsForTools, type ToolUse } from './service/tool-use.ts';
export { type ToolChecks, toolCheckJob } from './service/tools/job.ts';
export { providerFetchFor } from './service/usage/http.ts';
