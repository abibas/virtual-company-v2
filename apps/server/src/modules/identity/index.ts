// The identity module: GET /api/me with reconcile on sign-in, POST /api/companies/:companyId/sync, the webhook inbox
// (POST /api/webhooks/clerk), the database IdentityStore (repo.ts) the projector uses, and what the jobs loop (S1.10)
// calls: the company reconcile and the retry of inbox events. createApp mounts its router.
export { identityRoutes } from './routes.ts';
export {
  IDENTITY_EVENT_MAX_ATTEMPTS,
  type InboxDeps,
  type InboxRetry,
  type InboxTry,
  processInboxEvent,
  retryIdentityEvents,
} from './service/events.ts';
export { type CompanySync, projectIdentityEvent, reconcileCompany, type SyncDeps } from './service/sync.ts';
export { receiveWebhook, type WebhookResult, type WebhookStatus } from './service/webhooks.ts';
