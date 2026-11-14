import { CHAT_IMAGE_MAX_BYTES, CHAT_IMAGES_MAX, ChatImageType } from '@mwc/shared/chat-images';
import { newId } from '@mwc/shared/ids';
import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { chats, chatTurns } from './chats.ts';
import { bytea, createdAt, oneOf } from './columns.ts';
import { principals } from './principals.ts';
import { companyIdColumn, tenantForeignKey, tenantKey } from './tenant.ts';

const n = (value: number) => sql.raw(String(value));

/**
 * The images a person attached to a chat message (T-18, docs/harness.md "Images in a message"), kept with its turn:
 * at most 6 a turn (`position` 0 to 5, in the order they were attached), each at most 3 MB, PNG, JPEG, WebP or GIF as
 * its first bytes show, stored here as an agent icon is (not encrypted). The turn names them in `chat_turns.images`
 * (id, type, size, SHA-256), so its view and its spec carry them without reading this table; a runner fetches the
 * bytes before the turn starts, the web to show them. Removing the turn (a waiting message discarded) removes them.
 */
export const chatImages = pgTable(
  'chat_images',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    companyId: companyIdColumn(),
    chatId: uuid('chat_id').notNull(),
    turnId: uuid('turn_id').notNull(),
    position: integer('position').notNull(),
    contentType: text('content_type').$type<ChatImageType>().notNull(),
    bytes: bytea('bytes').notNull(),
    size: integer('size').notNull(),
    sha256: text('sha256').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    tenantKey('chat_images', t),
    unique('chat_images_turn_position_unique').on(t.companyId, t.turnId, t.position),
    tenantForeignKey('chat_images_chat_fk', t.companyId, t.chatId, chats),
    tenantForeignKey('chat_images_turn_fk', t.companyId, t.turnId, chatTurns).onDelete('cascade'),
    tenantForeignKey('chat_images_created_by_fk', t.companyId, t.createdBy, principals),
    check('chat_images_position_check', sql`${t.position} between 0 and ${n(CHAT_IMAGES_MAX - 1)}`),
    check('chat_images_content_type_check', oneOf(t.contentType, ChatImageType.options)),
    check(
      'chat_images_size_check',
      sql`${t.size} between 1 and ${n(CHAT_IMAGE_MAX_BYTES)} and octet_length(${t.bytes}) = ${t.size}`,
    ),
    check('chat_images_sha256_check', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

export type ChatImage = typeof chatImages.$inferSelect;
export type NewChatImage = typeof chatImages.$inferInsert;
