import { newId } from '@mwc/shared/ids';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { chats } from './chats.ts';
import { contacts } from './contacts.ts';
import { principals } from './principals.ts';
import { companyIdColumn, tenantForeignKey, tenantKey } from './tenant.ts';

/**
 * Who is in a chat (2026-11-14, docs/harness.md "Who is in a chat", migration `0040_chat_participants`): an agent's
 * message chats (a person's own, the rail's main chat, a Slack conversation's) are locked to their people. Each row is
 * one person: a member of the company (`principal_id`, a person's principal) or a contact from outside (`contact_id`, a
 * Slack conversation's), never both; once per chat. The chat's creator is one, the people they chat with too, and a
 * Slack conversation's chat has its contacts and the Slack connection's owner. Who added them (`added_by`, a principal;
 * null when Most Wanted did: the migration, a Slack message) and when. Tasks' conversations and flows' team chats keep
 * their own rules and have none.
 */
export const chatParticipants = pgTable(
  'chat_participants',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    companyId: companyIdColumn(),
    chatId: uuid('chat_id').notNull(),
    /** A member of the company: their principal. */
    principalId: uuid('principal_id'),
    /** A contact from outside (a Slack conversation's person). */
    contactId: uuid('contact_id'),
    /** Who added them; null when Most Wanted did. */
    addedBy: uuid('added_by'),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantKey('chat_participants', t),
    tenantForeignKey('chat_participants_chat_fk', t.companyId, t.chatId, chats),
    tenantForeignKey('chat_participants_principal_fk', t.companyId, t.principalId, principals),
    tenantForeignKey('chat_participants_contact_fk', t.companyId, t.contactId, contacts),
    tenantForeignKey('chat_participants_added_by_fk', t.companyId, t.addedBy, principals),
    unique('chat_participants_principal_unique').on(t.companyId, t.chatId, t.principalId),
    unique('chat_participants_contact_unique').on(t.companyId, t.chatId, t.contactId),
    check('chat_participants_who_check', sql`(${t.principalId} is null) <> (${t.contactId} is null)`),
    index('chat_participants_principal_idx').on(t.companyId, t.principalId),
  ],
);

export type ChatParticipant = typeof chatParticipants.$inferSelect;
export type NewChatParticipant = typeof chatParticipants.$inferInsert;
