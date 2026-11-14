import { type Decision, decisions, type TenantDb, type TenantValues } from '@mwc/db';
import type { DecisionOutcome } from '@mwc/shared/enums';
import { and, desc, eq, or, type SQL, sql } from 'drizzle-orm';

/**
 * The decision log's rows (2026-11-14), through the company's tenant only: one written, one read by its id (a page's
 * cursor), and a page of them by agent, chat, task, contact and outcome, newest first.
 */

/** Which decisions a page lists. */
export interface DecisionFilter {
  readonly agentId?: string | undefined;
  readonly chatId?: string | undefined;
  readonly taskId?: string | undefined;
  readonly contactId?: string | undefined;
  readonly outcome?: DecisionOutcome | undefined;
  /** Only those older than this one. */
  readonly before?: Pick<Decision, 'createdAt' | 'id'> | undefined;
  readonly limit: number;
}

const insert = async (t: TenantDb, values: TenantValues<typeof decisions>): Promise<Decision> =>
  (await t.insert(decisions, values).returning())[0] as Decision;

async function get(t: TenantDb, id: string): Promise<Decision | undefined> {
  const [row] = await t.select(decisions, eq(decisions.id, id));
  return row;
}

/** Older than a decision: an earlier time, or the same time and a lower id. */
const olderThan = (before: Pick<Decision, 'createdAt' | 'id'>): SQL | undefined =>
  or(
    sql`${decisions.createdAt} < ${before.createdAt}`,
    and(eq(decisions.createdAt, before.createdAt), sql`${decisions.id} < ${before.id}`),
  );

/** A page of the company's decisions, newest first. */
function list(t: TenantDb, filter: DecisionFilter): Promise<Decision[]> {
  const where = and(
    filter.agentId === undefined ? undefined : eq(decisions.agentId, filter.agentId),
    filter.chatId === undefined ? undefined : eq(decisions.chatId, filter.chatId),
    filter.taskId === undefined ? undefined : eq(decisions.taskId, filter.taskId),
    filter.contactId === undefined ? undefined : eq(decisions.contactId, filter.contactId),
    filter.outcome === undefined ? undefined : eq(decisions.outcome, filter.outcome),
    filter.before === undefined ? undefined : olderThan(filter.before),
  );
  return t
    .select(decisions, where)
    .orderBy(desc(decisions.createdAt), desc(decisions.id))
    .limit(filter.limit);
}

export const decisionsRepo = { insert, get, list };
