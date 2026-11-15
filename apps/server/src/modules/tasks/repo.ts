import { type AuditEntry, auditChanges, type TenantDb } from '@mwc/db';
import { artifactRows } from './repo/artifacts.ts';
import { checkInRows } from './repo/check-ins.ts';
import { conversationRows } from './repo/conversations.ts';
import { flowRows } from './repo/flows.ts';
import { nameRows } from './repo/names.ts';
import { roomRows } from './repo/room.ts';
import { sprintRows } from './repo/sprints.ts';
import { taskRows } from './repo/tasks.ts';
import { waitRows } from './repo/waits.ts';
import { wakeRows } from './repo/wakes.ts';

export type { ArtifactRow } from './repo/artifacts.ts';
export type { ConversationRow, ConversationTurnRow } from './repo/conversations.ts';
export type { TaskFilter } from './repo/tasks.ts';
export type { WaitRow } from './repo/waits.ts';

/**
 * The tasks module's data access, through the company's tenant only (S5.3a): the flows and their steps
 * (`repo/flows.ts`), the tasks and their history (`repo/tasks.ts`), the agents they name by slug or id
 * (`repo/names.ts`, read only), the company's lock (a task's number is the next one under it) and the audit rows; and
 * (S5.3b) the tasks' artifacts (`repo/artifacts.ts`) and their conversations (`repo/conversations.ts`, read only); and
 * (S6c) what wakes a flow's Lead agent (`repo/wakes.ts`; across companies, for the tick, `repo/wakes-due.ts`) and
 * what its check-ins read (`repo/check-ins.ts`, the chats' rows read only); and the flows' team rooms (`repo/room.ts`);
 * and (T-37) the flows' sprints (`repo/sprints.ts`); and (T-39) what tasks wait for (`repo/waits.ts`).
 */
export const tasksRepo = {
  flows: flowRows,
  tasks: taskRows,
  names: nameRows,
  artifacts: artifactRows,
  conversations: conversationRows,
  wakes: wakeRows,
  checkIns: checkInRows,
  room: roomRows,
  sprints: sprintRows,
  waits: waitRows,
  lockCompany: (t: TenantDb) => t.lockCompany(),
  audit: (t: TenantDb, entry: AuditEntry) => auditChanges(t, entry),
};

export type TasksRepo = typeof tasksRepo;
