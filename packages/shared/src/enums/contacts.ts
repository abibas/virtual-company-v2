import { z } from 'zod';

/**
 * Contacts (2026-11-14, docs/subscriptions.md "Contacts"), re-exported by `../enums.ts` with the other database enums:
 * where a contact came from.
 */

/** `contacts.source`: the outside system that made the contact; `slack`, a person who messaged an agent there. */
export const ContactSource = z.enum(['slack']);
export type ContactSource = z.infer<typeof ContactSource>;
