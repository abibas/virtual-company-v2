import { CHAT_PROMPT, CHAT_TITLE } from '@mwc/shared/chats';
import { ChatTurnKind, ChatTurnStatus, Harness } from '@mwc/shared/enums';
import { newId } from '@mwc/shared/ids';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, oneOf, updatedAt } from './columns.ts';
import { accessProfiles } from './credentials.ts';
import { machines } from './machines.ts';
import { agents } from './org.ts';
import { principals } from './principals.ts';
import { companyIdColumn, tenantForeignKey, tenantKey } from './tenant.ts';
import { users } from './users.ts';

/**
 * Chats with an agent (S5.1b, docs/harness.md "How a turn runs"): a conversation of one harness on one machine (a
 * harness session lives on the machine it began on), its turns (one prompt each, a process on the agent's machine) and
 * each turn's events as the runner read them. A chat may use another access profile than its agent's: only its owner
 * sets it (`profile_set_by`), and it goes when the profile does.
 */

const n = (value: number) => sql.raw(String(value));
const at = (name: string) => timestamp(name, { withTimezone: true });

export const chats = pgTable(
  'chats',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    companyId: companyIdColumn(),
    agentId: uuid('agent_id').notNull(),
    /** The agent's harness when the chat began: its session is that harness's. */
    harness: text('harness').$type<Harness>().notNull(),
    /** The agent's machine when the chat began: its session lives there. */
    machineId: uuid('machine_id').notNull(),
    /** Another access profile than the agent's, for this chat; null uses the agent's. A personal row. */
    profileId: uuid('profile_id').references(() => accessProfiles.id, { onDelete: 'set null' }),
    /** Who set `profile_id`: its owner, a person. */
    profileSetBy: uuid('profile_set_by').references(() => users.id),
    /** The harness's conversation to resume (Claude Code's session, Codex's thread); null until the first turn says. */
    sessionId: text('session_id'),
    /** The first prompt's start, at most 80 characters; null before the first turn. */
    title: text('title'),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: at('archived_at'),
  },
  (t) => [
    tenantKey('chats', t),
    tenantForeignKey('chats_agent_fk', t.companyId, t.agentId, agents),
    tenantForeignKey('chats_machine_fk', t.companyId, t.machineId, machines),
    tenantForeignKey('chats_created_by_fk', t.companyId, t.createdBy, principals),
    check('chats_harness_check', oneOf(t.harness, Harness.options)),
    check(
      'chats_title_check',
      sql`char_length(${t.title}) between ${n(CHAT_TITLE.min)} and ${n(CHAT_TITLE.max)}`,
    ),
    check('chats_session_id_check', sql`char_length(${t.sessionId}) between 1 and 200`),
    check('chats_profile_set_by_check', sql`${t.profileId} is null or ${t.profileSetBy} is not null`),
    index('chats_agent_idx').on(t.companyId, t.agentId, t.updatedAt),
    index('chats_profile_idx').on(t.profileId),
  ],
);

/**
 * A chat's turns, numbered from 1 (`seq`): the prompt, how far it got, the profile and credential it actually ran on
 * (plain ids, kept after either goes, like `credential_uses`), its reply, error and token usage. At most one turn of a
 * chat is queued or running at a time. Its `kind` (S5.2): a person's prompt, the harness's own `/compact`, or a Clear,
 * which runs no process (always `done`, on no credential) and marks where the chat's next turn starts a new
 * conversation.
 */
export const chatTurns = pgTable(
  'chat_turns',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    companyId: companyIdColumn(),
    chatId: uuid('chat_id').notNull(),
    seq: integer('seq').notNull(),
    kind: text('kind').$type<ChatTurnKind>().notNull().default('message'),
    prompt: text('prompt').notNull(),
    status: text('status').$type<ChatTurnStatus>().notNull().default('queued'),
    profileId: uuid('profile_id'),
    credentialId: uuid('credential_id'),
    startedAt: at('started_at'),
    endedAt: at('ended_at'),
    /** The reply: the result event's text. */
    resultText: text('result_text'),
    error: text('error'),
    /** The usage event: `{inputTokens, outputTokens, cachedInputTokens?, costUsd?}`. */
    usage: jsonb('usage').$type<Record<string, unknown>>(),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    tenantKey('chat_turns', t),
    unique('chat_turns_chat_seq_unique').on(t.companyId, t.chatId, t.seq),
    tenantForeignKey('chat_turns_chat_fk', t.companyId, t.chatId, chats),
    tenantForeignKey('chat_turns_created_by_fk', t.companyId, t.createdBy, principals),
    check('chat_turns_status_check', oneOf(t.status, ChatTurnStatus.options)),
    check('chat_turns_kind_check', oneOf(t.kind, ChatTurnKind.options)),
    check(
      'chat_turns_clear_check',
      sql`${t.kind} <> 'clear' or (${t.status} = 'done' and ${t.credentialId} is null)`,
    ),
    check('chat_turns_seq_check', sql`${t.seq} >= 1`),
    check(
      'chat_turns_prompt_check',
      sql`char_length(${t.prompt}) between ${n(CHAT_PROMPT.min)} and ${n(CHAT_PROMPT.max)}`,
    ),
    check('chat_turns_usage_check', sql`${t.usage} is null or jsonb_typeof(${t.usage}) = 'object'`),
    uniqueIndex('chat_turns_one_live_idx')
      .on(t.companyId, t.chatId)
      .where(sql`${t.status} in ('queued', 'running')`),
    index('chat_turns_status_idx').on(t.status),
  ],
);

/** A turn's events (a `TurnEvent` each), numbered from 1 by the runner in the order it read them. */
export const chatEvents = pgTable(
  'chat_events',
  {
    companyId: companyIdColumn(),
    turnId: uuid('turn_id').notNull(),
    seq: integer('seq').notNull(),
    event: jsonb('event').$type<Record<string, unknown>>().notNull(),
    at: at('at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.turnId, t.seq] }),
    tenantForeignKey('chat_events_turn_fk', t.companyId, t.turnId, chatTurns),
    check('chat_events_seq_check', sql`${t.seq} >= 1`),
    check('chat_events_event_check', sql`jsonb_typeof(${t.event}) = 'object'`),
  ],
);

export type Chat = typeof chats.$inferSelect;
export type NewChat = typeof chats.$inferInsert;
export type ChatTurn = typeof chatTurns.$inferSelect;
export type NewChatTurn = typeof chatTurns.$inferInsert;
export type ChatEvent = typeof chatEvents.$inferSelect;
export type NewChatEvent = typeof chatEvents.$inferInsert;
