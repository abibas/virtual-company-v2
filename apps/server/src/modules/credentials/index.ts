// The credentials module: people's own subscriptions, API keys and gateways, sealed under the master key (S3.1).
// createApp mounts its router; the steps after it use the internal service (storeCredential, useCredentialSecret).
export { credentialsRoutes } from './routes.ts';
export {
  type CredentialSecrets,
  credentialSecrets,
  type SecretDeps,
  type StoreCredentialInput,
  type UsedCredential,
} from './service/secrets.ts';
