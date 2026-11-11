import { TaskArtifactKind } from '@mwc/shared/enums';
import { ARTIFACT_LIMITS, STEP_NAME } from '@mwc/shared/flows';
import { newId } from '@mwc/shared/ids';
import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { chats, chatTurns } from './chats.ts';
import { bytea, createdAt, oneOf, updatedAt } from './columns.ts';
import { principals } from './principals.ts';
import { tasks } from './tasks.ts';
import { companyIdColumn, tenantForeignKey, tenantKey } from './tenant.ts';

const n = (value: number) => sql.raw(String(value));

/**
 * What a task's steps produced (S5.3b, docs/processes.md "Built in S5.3b"), kept with the task, the step and the round:
 * a file the runner collected from the step's folder (text or an image, its bytes here, at most 2 MB), the step's final
 * reply as its hand-off note, a link (S6), or a file the runner saw and left out (`skipped`, with why in `note`). The step
 * is a plain id with its name as it was, so a step removed later leaves its artifacts readable. One name per task, step
 * and round: a file collected again in the same round replaces the one before (`updated_at` moves). `chat_id` and
 * `turn_id` name the conversation and turn that made it; `created_by` the agent.
 */
export const taskArtifacts = pgTable(
  'task_artifacts',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    companyId: companyIdColumn(),
    taskId: uuid('task_id').notNull(),
    stepId: uuid('step_id').notNull(),
    stepName: text('step_name').notNull(),
    round: integer('round').notNull(),
    /** The file's path inside the round's folder (`notes.md`, `shots/login.png`), or `hand-off note`. */
    name: text('name').notNull(),
    kind: text('kind').$type<TaskArtifactKind>().notNull(),
    /** What its bytes are, as the server told them; null without bytes (a link, a skipped file). */
    contentType: text('content_type'),
    /** Its bytes' length (at most 2 MB), or a skipped file's size on the machine. */
    size: integer('size').notNull().default(0),
    sha256: text('sha256'),
    bytes: bytea('bytes'),
    /** A skipped file's reason, a link's address. */
    note: text('note'),
    chatId: uuid('chat_id'),
    turnId: uuid('turn_id'),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantKey('task_artifacts', t),
    unique('task_artifacts_name_unique').on(t.companyId, t.taskId, t.stepId, t.round, t.name),
    tenantForeignKey('task_artifacts_task_fk', t.companyId, t.taskId, tasks),
    tenantForeignKey('task_artifacts_chat_fk', t.companyId, t.chatId, chats),
    tenantForeignKey('task_artifacts_turn_fk', t.companyId, t.turnId, chatTurns),
    tenantForeignKey('task_artifacts_created_by_fk', t.companyId, t.createdBy, principals),
    check('task_artifacts_kind_check', oneOf(t.kind, TaskArtifactKind.options)),
    check('task_artifacts_round_check', sql`${t.round} >= 1`),
    check(
      'task_artifacts_step_name_check',
      sql`char_length(${t.stepName}) between ${n(STEP_NAME.min)} and ${n(STEP_NAME.max)}`,
    ),
    check('task_artifacts_name_check', sql`char_length(${t.name}) between 1 and ${n(ARTIFACT_LIMITS.name)}`),
    check(
      'task_artifacts_size_check',
      sql`${t.size} >= 0 and (${t.bytes} is null or ${t.size} <= ${n(ARTIFACT_LIMITS.fileBytes)})`,
    ),
    check('task_artifacts_sha256_check', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check('task_artifacts_note_check', sql`char_length(${t.note}) between 1 and ${n(ARTIFACT_LIMITS.note)}`),
    check('task_artifacts_content_type_check', sql`char_length(${t.contentType}) between 1 and 100`),
    check(
      'task_artifacts_bytes_check',
      sql`(${t.kind} in ('file', 'note')) = (${t.bytes} is not null) and (${t.bytes} is null) = (${t.contentType} is null) and (${t.bytes} is null) = (${t.sha256} is null) and (${t.bytes} is null or octet_length(${t.bytes}) = ${t.size})`,
    ),
    check(
      'task_artifacts_note_kind_check',
      sql`(${t.kind} in ('link', 'skipped')) = (${t.note} is not null)`,
    ),
    index('task_artifacts_task_idx').on(t.companyId, t.taskId, t.id),
  ],
);

export type TaskArtifact = typeof taskArtifacts.$inferSelect;
export type NewTaskArtifact = typeof taskArtifacts.$inferInsert;
