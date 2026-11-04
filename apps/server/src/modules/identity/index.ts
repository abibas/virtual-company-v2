// The identity module: GET /api/me with reconcile on sign-in, POST /api/companies/:companyId/sync, the database
// IdentityStore (repo.ts) the projector uses, and the projection paths the webhook inbox (S1.8) and the jobs loop
// (S1.10) call. createApp mounts its router.
export { identityRoutes } from './routes.ts';
export { type CompanySync, projectIdentityEvent, reconcileCompany, type SyncDeps } from './service/sync.ts';
