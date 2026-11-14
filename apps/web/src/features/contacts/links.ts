import { companyPath } from '../../app/nav.ts';

/**
 * Where contacts are (2026-11-14, docs/subscriptions.md "Contacts"): their list is a tab of Company structure
 * (`/:slug/structure/contacts`, which `/:slug/contacts` opens), a contact's page is `/:slug/contacts/:id`.
 */

/** The contacts' word in an address. */
export const CONTACTS = 'contacts';

/** The Contacts tab of Company structure. */
export const contactsListPath = (companySlug: string): string =>
  companyPath(companySlug, `structure/${CONTACTS}`);

/** A contact's page. */
export const contactPath = (companySlug: string, contactId: string): string =>
  companyPath(companySlug, `${CONTACTS}/${contactId}`);
