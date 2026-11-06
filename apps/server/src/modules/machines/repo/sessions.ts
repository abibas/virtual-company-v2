import { type RunnerSession, runnerSessions, type TenantDb } from '@mwc/db';
import { and, eq, gt, isNull, or } from 'drizzle-orm';

/** Runner sessions (`runner_sessions`), through the company's tenant: one per connection, from hello to close. */

const open = isNull(runnerSessions.disconnectedAt);

async function insert(
  t: TenantDb,
  values: { machineId: string; connectedAt: Date; version: string; remoteIp: string | null },
): Promise<RunnerSession> {
  const [row] = (await t.insert(runnerSessions, values).returning()) as [RunnerSession];
  return row;
}

/** Ends a session at `at` unless it has ended already. */
async function close(t: TenantDb, id: string, at: Date): Promise<void> {
  await t.update(runnerSessions, { disconnectedAt: at }, and(eq(runnerSessions.id, id), open));
}

/** The machine's sessions still open. */
const openOf = (t: TenantDb, machineId: string): Promise<RunnerSession[]> =>
  t.select(runnerSessions, and(eq(runnerSessions.machineId, machineId), open));

/** Every session of the company open now or ended after `since`, whenever it began. */
const since = (t: TenantDb, at: Date): Promise<RunnerSession[]> =>
  t.select(runnerSessions, or(open, gt(runnerSessions.disconnectedAt, at)));

export const sessionsRepo = { insert, close, openOf, since };
