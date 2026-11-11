import { type AuditEntry, auditChanges, type TenantDb } from '@mwc/db';
import { flowRows } from './repo/flows.ts';
import { nameRows } from './repo/names.ts';
import { taskRows } from './repo/tasks.ts';

export type { TaskFilter } from './repo/tasks.ts';

/**
 * The tasks module's data access, through the company's tenant only (S5.3a): the flows and their steps
 * (`repo/flows.ts`), the tasks and their history (`repo/tasks.ts`), the names of the principals they name
 * (`repo/names.ts`, read only), the company's lock (a task's number is the next one under it) and the audit rows.
 */
export const tasksRepo = {
  flows: flowRows,
  tasks: taskRows,
  names: nameRows,
  lockCompany: (t: TenantDb) => t.lockCompany(),
  audit: (t: TenantDb, entry: AuditEntry) => auditChanges(t, entry),
};

export type TasksRepo = typeof tasksRepo;
