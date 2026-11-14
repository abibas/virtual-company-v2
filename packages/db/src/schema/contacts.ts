import {
  CONTACT_EMAIL_MAX,
  CONTACT_HANDLE_MAX,
  CONTACT_NAME_MAX,
  CONTACT_NOTE_MAX,
  CONTACT_TITLE_MAX,
  CONTACT_URL_MAX,
} from '@mwc/shared/contacts';
import { ContactSource } from '@mwc/shared/enums';
import { newId } from '@mwc/shared/ids';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, oneOf, updatedAt } from './columns.ts';
import { companyIdColumn, tenantKey } from './tenant.ts';

const n = (value: number) => sql.raw(String(value));
const at = (name: string) => timestamp(name, { withTimezone: true });

/**
 * A company's contacts (2026-11-14, docs/subscriptions.md "Contacts", migration `0038_contacts`): the people outside it
 * who talk to its agents, one per person and outside account. A Slack person is one per workspace (`slack_team_id`) and
 * Slack user (`slack_user_id`), made by Most Wanted the first time their message wakes one of the company's agents and
 * kept up to date (name, avatar, title, email, handle) from Slack on each message after. The chats for their Slack
 * conversations (`slack_threads.contact_id`) and their turns (`chat_turns.contact_id`) name them. Admins and owners keep
 * a note and archive one; nothing deletes a contact.
 */
export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    companyId: companyIdColumn(),
    source: text('source').$type<ContactSource>().notNull(),
    name: text('name').notNull(),
    avatarUrl: text('avatar_url'),
    /** Their email, when the outside system gives it (Slack's `users:read.email`). */
    email: text('email'),
    title: text('title'),
    /** Their handle there (Slack's username). */
    handle: text('handle'),
    /** The Slack workspace (`T…`) and person (`U…`) of a Slack contact. */
    slackTeamId: text('slack_team_id'),
    slackUserId: text('slack_user_id'),
    firstSeenAt: at('first_seen_at').notNull(),
    lastSeenAt: at('last_seen_at').notNull(),
    note: text('note'),
    archivedAt: at('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantKey('contacts', t),
    unique('contacts_slack_unique').on(t.companyId, t.slackTeamId, t.slackUserId),
    check('contacts_source_check', oneOf(t.source, ContactSource.options)),
    check(
      'contacts_slack_check',
      sql`${t.source} <> 'slack' or (${t.slackTeamId} is not null and ${t.slackUserId} is not null)`,
    ),
    check('contacts_slack_team_check', sql`char_length(${t.slackTeamId}) between 1 and 40`),
    check('contacts_slack_user_check', sql`char_length(${t.slackUserId}) between 1 and 40`),
    check('contacts_name_check', sql`char_length(${t.name}) between 1 and ${n(CONTACT_NAME_MAX)}`),
    check('contacts_avatar_check', sql`char_length(${t.avatarUrl}) between 1 and ${n(CONTACT_URL_MAX)}`),
    check('contacts_email_check', sql`char_length(${t.email}) between 3 and ${n(CONTACT_EMAIL_MAX)}`),
    check('contacts_title_check', sql`char_length(${t.title}) between 1 and ${n(CONTACT_TITLE_MAX)}`),
    check('contacts_handle_check', sql`char_length(${t.handle}) between 1 and ${n(CONTACT_HANDLE_MAX)}`),
    check('contacts_note_check', sql`char_length(${t.note}) between 1 and ${n(CONTACT_NOTE_MAX)}`),
    check('contacts_seen_check', sql`${t.lastSeenAt} >= ${t.firstSeenAt}`),
    index('contacts_seen_idx').on(t.companyId, t.lastSeenAt),
  ],
);

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
