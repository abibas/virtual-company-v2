// The members module: the member list, role changes and removals, and the outbox handlers of a member at the
// identity provider (update_role, remove_member) for the jobs loop. createApp mounts its router.
export { membersRoutes } from './routes.ts';
export { memberOutboxHandlers } from './service/provider.ts';
