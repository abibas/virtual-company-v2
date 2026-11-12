import { companies, type DbHandle, flowSteps, flows, leadWakeEvents, principals, tasks } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { and, eq, isNotNull, isNull, min, ne, sql } from 'drizzle-orm';

/**
 * The Lead wake-ups across every company (S6c, the server's wake-up tick): the one place this module reads without a
 * tenant, listed in biome.json's exemption, since any flow's Lead may be due. It only stamps and finds; each flow's
 * events are read, told and marked through its company's tenant (`service/wake/deliver.ts`), and so are its
 * check-ins (`service/wake/check-in.ts`).
 */

/** Stamps the pending events the tick sees for the first time with its clock; returns how many. */
export async function stampSeen(db: DbHandle, now: Date): Promise<number> {
  const rows = await rawDb(db)
    .update(leadWakeEvents)
    .set({ seenAt: now })
    .where(and(eq(leadWakeEvents.outcome, 'pending'), isNull(leadWakeEvents.seenAt)))
    .returning({ id: leadWakeEvents.id });
  return rows.length;
}

/** A flow with pending events: its company, and its oldest seen event with the flow's quiet window. */
export interface WaitingFlow {
  readonly companyId: string;
  readonly flowId: string;
  readonly oldestSeen: Date;
  readonly windowSeconds: number;
}

/** The flows with pending events seen by the tick, in companies not deleted, the longest waiting first. */
export async function waitingFlows(db: DbHandle, limit: number): Promise<WaitingFlow[]> {
  const rows = await rawDb(db)
    .select({
      companyId: leadWakeEvents.companyId,
      flowId: leadWakeEvents.flowId,
      oldestSeen: min(leadWakeEvents.seenAt),
      windowSeconds: flows.wakeWindowSeconds,
    })
    .from(leadWakeEvents)
    .innerJoin(flows, and(eq(flows.companyId, leadWakeEvents.companyId), eq(flows.id, leadWakeEvents.flowId)))
    .innerJoin(companies, eq(companies.id, leadWakeEvents.companyId))
    .where(
      and(
        eq(leadWakeEvents.outcome, 'pending'),
        isNotNull(leadWakeEvents.seenAt),
        ne(companies.status, 'deleted'),
        isNull(companies.deletedAt),
      ),
    )
    .groupBy(leadWakeEvents.companyId, leadWakeEvents.flowId, flows.wakeWindowSeconds)
    .orderBy(min(leadWakeEvents.seenAt))
    .limit(limit);
  return rows.map((row) => ({ ...row, oldestSeen: row.oldestSeen as Date }));
}

/** A flow that checks in with its agent Lead and has work: its company, and the minutes between check-ins. */
export interface CheckInFlow {
  readonly companyId: string;
  readonly flowId: string;
  readonly minutes: number;
}

/**
 * The flows with check-ins on whose Lead is an agent and that have active or escalated tasks, in companies not deleted,
 * the longest since their Lead's last wake-up first (never woken first).
 */
export function checkInFlows(db: DbHandle, limit: number): Promise<CheckInFlow[]> {
  const lastWoke = sql`(select max(w.delivered_at) from lead_wake_events w where w.company_id = ${flows.companyId} and w.flow_id = ${flows.id} and w.outcome = 'woke')`;
  return rawDb(db)
    .select({
      companyId: flows.companyId,
      flowId: flows.id,
      minutes: sql<number>`${flows.wakeCheckInMinutes}`,
    })
    .from(flows)
    .innerJoin(companies, eq(companies.id, flows.companyId))
    .innerJoin(
      principals,
      and(eq(principals.companyId, flows.companyId), eq(principals.id, flows.leadPrincipalId)),
    )
    .where(
      and(
        ne(companies.status, 'deleted'),
        isNull(companies.deletedAt),
        eq(principals.kind, 'agent'),
        isNotNull(flows.wakeCheckInMinutes),
        sql`exists (select 1 from tasks t where t.company_id = ${flows.companyId} and t.flow_id = ${flows.id} and t.state in ('active', 'escalated'))`,
      ),
    )
    .orderBy(sql`${lastWoke} asc nulls first`, flows.id)
    .limit(limit);
}

/** A task waiting for a person's sign-off longer than its flow's hours, not told of since it began to wait. */
export interface WaitingSignoff {
  readonly companyId: string;
  readonly flowId: string;
  readonly taskId: string;
  readonly stepName: string;
  readonly since: Date;
}

/**
 * The tasks at a person's Sign-off (`needs_person`) in flows that wake their Lead after so many hours, in companies not
 * deleted, waiting longer than that by `now` (since the task last changed), with no `signoff_waiting` event written
 * since.
 */
export function waitingSignoffs(db: DbHandle, now: Date, limit: number): Promise<WaitingSignoff[]> {
  const nowIso = now.toISOString();
  return rawDb(db)
    .select({
      companyId: tasks.companyId,
      flowId: tasks.flowId,
      taskId: tasks.id,
      stepName: flowSteps.name,
      since: tasks.updatedAt,
    })
    .from(tasks)
    .innerJoin(flows, and(eq(flows.companyId, tasks.companyId), eq(flows.id, tasks.flowId)))
    .innerJoin(
      flowSteps,
      and(eq(flowSteps.companyId, tasks.companyId), eq(flowSteps.id, tasks.currentStepId)),
    )
    .innerJoin(companies, eq(companies.id, tasks.companyId))
    .where(
      and(
        ne(companies.status, 'deleted'),
        isNull(companies.deletedAt),
        eq(tasks.state, 'active'),
        eq(tasks.stepState, 'needs_person'),
        isNotNull(flows.wakeSignoffHours),
        sql`${tasks.updatedAt} <= ${nowIso}::timestamptz - make_interval(hours => ${flows.wakeSignoffHours})`,
        sql`not exists (select 1 from lead_wake_events w where w.company_id = ${tasks.companyId} and w.task_id = ${tasks.id} and w.kind = 'signoff_waiting' and w.created_at >= ${tasks.updatedAt})`,
      ),
    )
    .orderBy(tasks.updatedAt)
    .limit(limit);
}
