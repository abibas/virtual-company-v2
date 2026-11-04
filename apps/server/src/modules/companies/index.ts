// The companies module: create, list mine, read, rename and soft-delete, and the outbox handlers of the company's
// organization at the identity provider (create_org, delete_org) for the jobs loop. createApp mounts its router.
export { companiesRoutes } from './routes.ts';
export { companyOutboxHandlers } from './service/organizations.ts';
