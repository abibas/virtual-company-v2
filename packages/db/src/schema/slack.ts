import { SLACK_INBOUND_PER_HOUR, SLACK_PEOPLE_MAX } from '@mwc/shared/credentials';
import { SlackInboundStatus, SlackWake } from '@mwc/shared/enums';
import { newId } from '@mwc/shared/ids';
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { chats } from './chats.ts';
import { bytea, createdAt, oneOf, updatedAt } from './columns.ts';
import { credentials } from './credentials.ts';
import { agents } from './org.ts';
import { companyIdColumn, tenantForeignKey, tenantKey } from './tenant.ts';
import { users } from './users.ts';

/**
 * Receiving Slack messages (2026-11-13, docs/subscriptions.md "Slack: receiving messages", migration `0037_slack_inbound`):
 * a Slack bot sign-in's inbound settings with its sealed app-level token (`slack_connections`, personal), the messages
 * agents posted through a Slack sign-in (`slack_posts`, personal: a reply in their thread goes to the agent that posted
 * there), and each agent's chat for one Slack conversation (`slack_threads`, a company's).
 */

const n = (value: number) => sql.raw(String(value));
const at = (name: string) => timestamp(name, { withTimezone: true });

/**
 * A Slack bot sign-in's inbound settings, one row per sign-in (its id is the row's key), removed with it. A personal
 * table, reached through `owned(db, userId)`. The app-level token (`xapp-`) Socket Mode opens with is sealed like a
 * credential's secret (AES-256-GCM, the additional data `slack_app_token|<credential_id>|<owner_user_id>`), all four
 * columns or none. Inbound on, it keeps a Socket Mode connection; who may wake agents (`wake`: anyone in the channels
 * an agent's profile reaches, or the `people` listed), the default agent (a company's agent: plain ids, read through that
 * company), the cap on turns an hour, and where the connection stands (`status`, in words in `status_message`).
 */
export const slackConnections = pgTable(
  'slack_connections',
  {
    credentialId: uuid('credential_id')
      .primaryKey()
      .references(() => credentials.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    appKeyVersion: integer('app_key_version'),
    appIv: bytea('app_iv'),
    appAuthTag: bytea('app_auth_tag'),
    appCiphertext: bytea('app_ciphertext'),
    /** Receive messages: keep a Socket Mode connection. */
    inbound: boolean('inbound').notNull().default(false),
    wake: text('wake').$type<SlackWake>().notNull().default('listed'),
    /** The people allowed when `wake` is `listed`: `SlackPerson[]` of `@mwc/shared/credentials`. */
    people: jsonb('people').$type<Record<string, unknown>[]>().notNull().default([]),
    /** The agent a fresh mention or a DM goes to: its company and its id. */
    defaultCompanyId: uuid('default_company_id'),
    defaultAgentId: uuid('default_agent_id'),
    maxPerHour: integer('max_per_hour').notNull().default(SLACK_INBOUND_PER_HOUR.default),
    status: text('status').$type<SlackInboundStatus>().notNull().default('off'),
    statusMessage: text('status_message'),
    statusAt: at('status_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'slack_connections_app_token_check',
      sql`(${t.appKeyVersion} is null) = (${t.appCiphertext} is null) and (${t.appIv} is null) = (${t.appCiphertext} is null) and (${t.appAuthTag} is null) = (${t.appCiphertext} is null)`,
    ),
    check('slack_connections_app_iv_check', sql`octet_length(${t.appIv}) = 12`),
    check('slack_connections_app_auth_tag_check', sql`octet_length(${t.appAuthTag}) = 16`),
    check('slack_connections_wake_check', oneOf(t.wake, SlackWake.options)),
    check(
      'slack_connections_people_check',
      sql`jsonb_typeof(${t.people}) = 'array' and jsonb_array_length(${t.people}) <= ${n(SLACK_PEOPLE_MAX)}`,
    ),
    check(
      'slack_connections_default_agent_check',
      sql`(${t.defaultCompanyId} is null) = (${t.defaultAgentId} is null)`,
    ),
    check(
      'slack_connections_max_per_hour_check',
      sql`${t.maxPerHour} between ${n(SLACK_INBOUND_PER_HOUR.min)} and ${n(SLACK_INBOUND_PER_HOUR.max)}`,
    ),
    check('slack_connections_status_check', oneOf(t.status, SlackInboundStatus.options)),
    check('slack_connections_status_message_check', sql`char_length(${t.statusMessage}) between 1 and 300`),
    check('slack_connections_inbound_check', sql`not ${t.inbound} or ${t.appCiphertext} is not null`),
    index('slack_connections_owner_idx').on(t.ownerUserId),
    index('slack_connections_inbound_idx').on(t.inbound),
  ],
);

/**
 * A message an agent posted in Slack through a Slack sign-in (its tools' posts and replies, and its answers to a Slack
 * message), so a reply in that thread goes to the agent that posted there, and an answer is not posted twice. A personal
 * table of the sign-in's owner, removed with the sign-in; the company, agent, chat and turn are plain ids, like
 * `credential_uses`.
 */
export const slackPosts = pgTable(
  'slack_posts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    credentialId: uuid('credential_id')
      .notNull()
      .references(() => credentials.id, { onDelete: 'cascade' }),
    channelId: text('channel_id').notNull(),
    ts: text('ts').notNull(),
    /** The thread it went into; null for a message of the channel itself. */
    threadTs: text('thread_ts'),
    companyId: uuid('company_id').notNull(),
    agentId: uuid('agent_id').notNull(),
    chatId: uuid('chat_id'),
    turnId: uuid('turn_id'),
    at: at('at').notNull().defaultNow(),
  },
  (t) => [
    unique('slack_posts_message_unique').on(t.credentialId, t.channelId, t.ts),
    check('slack_posts_ts_check', sql`char_length(${t.ts}) between 1 and 40`),
    check('slack_posts_channel_check', sql`char_length(${t.channelId}) between 1 and 40`),
    index('slack_posts_thread_idx').on(t.credentialId, t.channelId, t.threadTs),
    index('slack_posts_turn_idx').on(t.turnId),
  ],
);

/**
 * An agent's chat for one Slack conversation (a channel's thread, or a DM itself when its message is in no thread),
 * through one Slack sign-in (a plain id: the personal row stays its owner's): the messages there wake the agent in that
 * chat, which keeps its context across them. A chat that cannot go on (archived, or the agent moved) is replaced, so the
 * row then names the new one.
 */
export const slackThreads = pgTable(
  'slack_threads',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    companyId: companyIdColumn(),
    agentId: uuid('agent_id').notNull(),
    chatId: uuid('chat_id').notNull(),
    credentialId: uuid('credential_id').notNull(),
    channelId: text('channel_id').notNull(),
    /** The thread's first message; null: a DM's own conversation. */
    threadTs: text('thread_ts'),
    /** Where it is, in words: `#general`, `a DM with Ihor`. */
    place: text('place').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantKey('slack_threads', t),
    tenantForeignKey('slack_threads_agent_fk', t.companyId, t.agentId, agents),
    tenantForeignKey('slack_threads_chat_fk', t.companyId, t.chatId, chats),
    unique('slack_threads_conversation_unique')
      .on(t.companyId, t.agentId, t.credentialId, t.channelId, t.threadTs)
      .nullsNotDistinct(),
    unique('slack_threads_chat_unique').on(t.companyId, t.chatId),
    check('slack_threads_place_check', sql`char_length(${t.place}) between 1 and 200`),
  ],
);

export type SlackConnection = typeof slackConnections.$inferSelect;
export type NewSlackConnection = typeof slackConnections.$inferInsert;
export type SlackPost = typeof slackPosts.$inferSelect;
export type SlackThread = typeof slackThreads.$inferSelect;
