/**
 * Contacts (2026-11-14, docs/subscriptions.md "Contacts"): the people outside a company who talk to its agents (a Slack
 * person who messaged one), made the first time their message wakes an agent. The limits the API, the database and the
 * web share.
 */

/** A contact's name, as their outside system gives it. */
export const CONTACT_NAME_MAX = 120;
/** Their title ("Senior Engineer"). */
export const CONTACT_TITLE_MAX = 200;
/** Their email, when the outside system gives it. */
export const CONTACT_EMAIL_MAX = 320;
/** Their avatar's address. */
export const CONTACT_URL_MAX = 500;
/** Their handle in the outside system (Slack's username). */
export const CONTACT_HANDLE_MAX = 80;
/** The note admins keep on a contact. */
export const CONTACT_NOTE_MAX = 2000;

/**
 * The window of `GET …/contacts/interactions` (the org chart's Requesters): the last 7 days unless `since` says, at most
 * 90 days back.
 */
export const CONTACT_INTERACTIONS = { defaultDays: 7, maxDays: 90 } as const;
