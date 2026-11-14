// The contacts module (2026-11-14, docs/subscriptions.md "Contacts"): the people outside a company who talk to its
// agents. createApp mounts its routes (the list, a contact's page, the note and archive, the interactions for the org
// chart); the integrations module makes or updates a Slack person's contact when their message wakes an agent
// (`seenOnSlack`).

export { contactsRoutes } from './routes.ts';
export type { SlackPersonSeen } from './rules.ts';
export { seenOnSlack } from './service/seen.ts';
