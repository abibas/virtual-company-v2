import { type AuditEntry, auditChanges, type TenantDb } from '@mwc/db';
import { artifactRows } from './repo/artifacts.ts';
import { conversationRows } from './repo/conversations.ts';
import { flowRows } from './repo/flows.ts';
import { nameRows } from './repo/names.ts';
import { taskRows } from './repo/tasks.ts';
import { wakeRows } from './repo/wakes.ts';

export type { ArtifactRow } from './repo/artifacts.ts';
export type { ConversationRow, ConversationTurnRow } from './repo/conversations.ts';
export type { TaskFilter } from './repo/tasks.ts';

/**
 * The tasks module's data access, through the company's tenant only (S5.3a): the flows and their steps
 * (`repo/flows.ts`), the tasks and their history (`repo/tasks.ts`), the agents they name by slug or id
 * (`repo/names.ts`, read only), the company's lock (a task's number is the next one under it) and the audit rows; and
 * (S5.3b) the tasks' artifacts (`repo/artifacts.ts`) and their conversations (`repo/conversations.ts`, read only); and
 * (S6c) what wakes a flow's Lead agent (`repo/wakes.ts`; across companies, for the tick, `repo/wakes-due.ts`).
 */
export const tasksRepo = {
  flows: flowRows,
  tasks: taskRows,
  names: nameRows,
  artifacts: artifactRows,
  conversations: conversationRows,
  wakes: wakeRows,
  lockCompany: (t: TenantDb) => t.lockCompany(),
  audit: (t: TenantDb, entry: AuditEntry) => auditChanges(t, entry),
};

export type TasksRepo = typeof tasksRepo;
