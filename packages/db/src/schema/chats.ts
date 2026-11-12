import { CHAT_PROMPT, CHAT_TITLE } from '@mwc/shared/chats';
import { ChatTurnDelivery, ChatTurnKind, ChatTurnStatus, Harness, MachineWait } from '@mwc/shared/enums';
import { newId } from '@mwc/shared/ids';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
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
import { flows } from './flows.ts';
import { machines } from './machines.ts';
import { agents } from './org.ts';
import { principals } from './principals.ts';
import { roomMessages } from './room-messages.ts';
import { tasks } from './tasks.ts';
import { companyIdColumn, tenantForeignKey, tenantKey } from './tenant.ts';
import { users } from './users.ts';

/**
 * Chats with an agent (S5.1b, docs/harness.md "How a turn runs"): a conversation of one harness on one machine (a
 * harness session lives on the machine it began on), its turns (one prompt each, a process on the agent's machine) and
 * each turn's events as the runner read them. A chat may use another access profile than its agent's: only its owner
 * sets it (`profile_set_by`), and it goes when the profile does. A branch (migration 0018) is a chat that continues
 * another's conversation from one of its replies: it names that chat and turn, and its first turn forks the session.
 * A task's conversation at a step (migration 0023, S5.3b) is a chat too: it names the task, the step and the round it
 * began in, and stays out of the agent's own chat list. A flow's team chat (migration 0025, S6c) names the flow whose
 * Lead it is with: the chat where Most Wanted wakes that Lead agent with its team's events.
 */

const n = (value: number) => sql.raw(String(value));
const at = (name: string) => timestamp(name, { withTimezone: true });

/** The turns' key, for a branch's foreign key (a function with its type said, since the turns point back at chats). */
const turnKey = (): { readonly companyId: AnyPgColumn; readonly id: AnyPgColumn } => chatTurns;

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
    /** The chat this one branched from (its parent); null for a chat begun anew. */
    branchedFromChatId: uuid('branched_from_chat_id'),
    /** The parent's turn whose reply this branch continues from. */
    branchedFromTurnId: uuid('branched_from_turn_id'),
    /** True until the branch's first turn forked the parent's session (`session_id` is the parent's until then). */
    forkPending: boolean('fork_pending').notNull().default(false),
    /** A task's conversation at one of its steps (S5.3b): the task; null for a chat begun with the agent. */
    taskId: uuid('task_id'),
    /** That step (a plain id: a step removed later leaves its conversations readable). */
    taskStepId: uuid('task_step_id'),
    /** The round of the step the conversation began in. */
    taskRound: integer('task_round'),
    /** A flow's team chat with its Lead agent (S6c): the flow; null for any other chat. */
    flowId: uuid('flow_id'),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: at('archived_at'),
  },
  (t) => [
    tenantKey('chats', t),
    tenantForeignKey('chats_branched_from_chat_fk', t.companyId, t.branchedFromChatId, t),
    tenantForeignKey('chats_branched_from_turn_fk', t.companyId, t.branchedFromTurnId, turnKey()),
    tenantForeignKey('chats_agent_fk', t.companyId, t.agentId, agents),
    tenantForeignKey('chats_machine_fk', t.companyId, t.machineId, machines),
    tenantForeignKey('chats_created_by_fk', t.companyId, t.createdBy, principals),
    tenantForeignKey('chats_task_fk', t.companyId, t.taskId, tasks),
    tenantForeignKey('chats_flow_fk', t.companyId, t.flowId, flows),
    check('chats_harness_check', oneOf(t.harness, Harness.options)),
    check(
      'chats_title_check',
      sql`char_length(${t.title}) between ${n(CHAT_TITLE.min)} and ${n(CHAT_TITLE.max)}`,
    ),
    check('chats_session_id_check', sql`char_length(${t.sessionId}) between 1 and 200`),
    check('chats_profile_set_by_check', sql`${t.profileId} is null or ${t.profileSetBy} is not null`),
    check('chats_branch_check', sql`${t.branchedFromTurnId} is null or ${t.branchedFromChatId} is not null`),
    check('chats_fork_pending_check', sql`not ${t.forkPending} or ${t.sessionId} is not null`),
    check(
      'chats_task_check',
      sql`(${t.taskId} is null) = (${t.taskStepId} is null) and (${t.taskId} is null) = (${t.taskRound} is null) and (${t.taskRound} is null or ${t.taskRound} >= 1)`,
    ),
    index('chats_agent_idx').on(t.companyId, t.agentId, t.updatedAt),
    index('chats_profile_idx').on(t.profileId),
    index('chats_branched_from_idx').on(t.companyId, t.branchedFromChatId),
    check('chats_flow_check', sql`${t.flowId} is null or ${t.taskId} is null`),
    index('chats_task_idx').on(t.companyId, t.taskId, t.taskStepId, t.createdAt),
    index('chats_flow_idx').on(t.companyId, t.flowId, t.createdAt),
  ],
);

/**
 * A chat's turns, numbered from 1 (`seq`): the prompt, how far it got, the profile and credential it actually ran on
 * (plain ids, kept after either goes, like `credential_uses`), its reply, error and token usage. At most one turn of a
 * chat runs at a time; others wait `queued` behind it (S5.2 step 6, migration 0014), each with how it was sent while the
 * agent worked (`delivery`). Its `kind` (S5.2): a person's prompt, the harness's own `/compact`, or a Clear, which runs
 * no process (always `done`, on no credential) and marks where the chat's next turn starts a new conversation. A turn
 * Most Wanted queued itself (`system`, S6c: a Lead's wake-up) names the agent as its sender and shows as Most Wanted's.
 * A turn for an agent whose machine was stopped waits `queued` while the machine starts (`machine_wait_at`, migration
 * 0026): it starts once the machine's runner connects, and fails when the start fails or takes too long. Since 0028 a
 * turn also waits so while every slot of its machine is taken (`machine_wait` says which: `stopped` or `slots`), and
 * starts when a turn on that machine ends. A turn Most Wanted queued in an agent's room conversation (a flow's chat) for
 * a person's message in the team room names that message (`room_message_id`, docs/processes.md "The team room").
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
    /** How a message sent while a turn ran was to reach the agent (S5.2 step 6); null for a turn that started at once. */
    delivery: text('delivery').$type<ChatTurnDelivery>(),
    /** Queued by Most Wanted itself, not by a person (S6c: a Lead's wake-up); `created_by` is then the agent. */
    system: boolean('system').notNull().default(false),
    /** Since when the turn waits for its machine (to start, or for a free slot); null for any other turn. */
    machineWaitAt: at('machine_wait_at'),
    /** What it waits for: the machine to start (`stopped`), or a free slot (`slots`). */
    machineWait: text('machine_wait').$type<MachineWait>(),
    /** The team room's message a room turn answers (a system turn); null for any other turn. */
    roomMessageId: uuid('room_message_id'),
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
    tenantForeignKey('chat_turns_room_message_fk', t.companyId, t.roomMessageId, roomMessages),
    check('chat_turns_room_message_check', sql`${t.roomMessageId} is null or ${t.system}`),
    check('chat_turns_status_check', oneOf(t.status, ChatTurnStatus.options)),
    check('chat_turns_kind_check', oneOf(t.kind, ChatTurnKind.options)),
    check('chat_turns_delivery_check', oneOf(t.delivery, ChatTurnDelivery.options)),
    check('chat_turns_machine_wait_check', oneOf(t.machineWait, MachineWait.options)),
    check(
      'chat_turns_machine_wait_at_check',
      sql`${t.machineWait} is null or ${t.machineWaitAt} is not null`,
    ),
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
    uniqueIndex('chat_turns_one_running_idx').on(t.companyId, t.chatId).where(sql`${t.status} = 'running'`),
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
