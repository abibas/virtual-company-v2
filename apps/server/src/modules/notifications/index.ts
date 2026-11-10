// The notifications module (S2.9): a person's own notifications and email setting (its router), the identity store's
// side of a membership's change (`membershipNoticeHook`) and the email delivery the jobs loop runs (`deliverEmails`).
// createApp mounts its router; the org and members modules call its service in their own transactions.
export { notificationsRoutes } from './routes.ts';
export { type DeliveryDeps, deliverEmails, type EmailDelivery } from './service/delivery.ts';
export { membershipNoticeHook } from './service.ts';
