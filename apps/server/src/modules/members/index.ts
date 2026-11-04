// The members module: the member list, role changes and removals, invitations, and the outbox handlers of a member
// and of an invitation at the identity provider (update_role, remove_member, invite, revoke_invite) for the jobs
// loop. createApp mounts its router.
export { membersRoutes } from './routes.ts';
export { invitationOutboxHandlers } from './service/invitation-provider.ts';
export { memberOutboxHandlers } from './service/provider.ts';
