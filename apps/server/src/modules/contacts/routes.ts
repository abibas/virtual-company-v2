import type { ServerDeps } from '../../platform/env.ts';
import { newRouter } from '../../platform/http/router.ts';
import { contactRoutes } from './routes/contacts.ts';
import { interactionRoutes } from './routes/interactions.ts';

/**
 * The contacts module's routes (2026-11-14, docs/subscriptions.md "Contacts"): the interactions first (their path would
 * otherwise read as a contact's id), then the list, a contact's page and the change admins make.
 */
export function contactsRoutes(deps: ServerDeps) {
  return newRouter().route('/', interactionRoutes(deps)).route('/', contactRoutes(deps));
}
