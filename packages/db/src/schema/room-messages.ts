import { RoomMessageKind } from '@mwc/shared/enums';
import { ROOM_BODY_MAX } from '@mwc/shared/flows';
import { newId } from '@mwc/shared/ids';
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { oneOf } from './columns.ts';
import { flows } from './flows.ts';
import { principals } from './principals.ts';
import { tasks } from './tasks.ts';
import { companyIdColumn, tenantForeignKey, tenantKey } from './tenant.ts';

const n = (value: number) => sql.raw(String(value));

/**
 * A flow's team room (docs/processes.md "The team room"): one feed of messages, each by a person, an agent or Most
 * Wanted (no author). A person's message (`message`) asks the team's agents for a turn each in their own room
 * conversation (`asked` counts the turns it began, for the room's cap an hour); an agent posts one line when its step
 * ends (`step_end`, its task and its move in `details`); an agent's reply (`reply`) is the final reply of a turn Most
 * Wanted queued in its room conversation (`chat_id`, `turn_id`: plain ids, a waiting turn may be discarded), and Most
 * Wanted's notices (`notice`: a Lead's wake-up or check-in with its turn, agents not asked) have no author. Written
 * with the app's clock (`created_at`), read in its order.
 */
export const roomMessages = pgTable(
  'room_messages',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    companyId: companyIdColumn(),
    flowId: uuid('flow_id').notNull(),
    kind: text('kind').$type<RoomMessageKind>().notNull(),
    /** Who wrote it: a person or an agent; null for Most Wanted's own notices. */
    authorPrincipalId: uuid('author_principal_id'),
    body: text('body').notNull(),
    /** The task a step-end line (or a notice) is about. */
    taskId: uuid('task_id'),
    /** What the kind adds: a step end's `{action, from, to, round}`, a notice's `{about}`. */
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    /** A person's message: how many agents' turns it began; null for any other message. */
    asked: integer('asked'),
    /** The room conversation and the turn a reply (or a wake-up's notice) belongs to. */
    chatId: uuid('chat_id'),
    turnId: uuid('turn_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantKey('room_messages', t),
    tenantForeignKey('room_messages_flow_fk', t.companyId, t.flowId, flows),
    tenantForeignKey('room_messages_author_fk', t.companyId, t.authorPrincipalId, principals),
    tenantForeignKey('room_messages_task_fk', t.companyId, t.taskId, tasks),
    check('room_messages_kind_check', oneOf(t.kind, RoomMessageKind.options)),
    check('room_messages_author_check', sql`(${t.kind} = 'notice') = (${t.authorPrincipalId} is null)`),
    check('room_messages_body_check', sql`char_length(${t.body}) between 1 and ${n(ROOM_BODY_MAX)}`),
    check('room_messages_step_end_check', sql`${t.kind} <> 'step_end' or ${t.taskId} is not null`),
    check(
      'room_messages_asked_check',
      sql`${t.asked} is null or (${t.kind} = 'message' and ${t.asked} >= 0)`,
    ),
    check('room_messages_details_check', sql`jsonb_typeof(${t.details}) = 'object'`),
    check('room_messages_turn_check', sql`${t.turnId} is null or ${t.chatId} is not null`),
    index('room_messages_flow_idx').on(t.companyId, t.flowId, t.createdAt, t.id),
  ],
);

export type RoomMessage = typeof roomMessages.$inferSelect;
export type NewRoomMessage = typeof roomMessages.$inferInsert;
