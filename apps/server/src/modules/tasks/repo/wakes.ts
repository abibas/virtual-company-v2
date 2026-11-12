import {
  chats,
  type LeadWakeEvent,
  leadWakeEvents,
  type TenantDb,
  type TenantSet,
  type TenantValues,
  taskEvents,
} from '@mwc/db';
import { and, asc, desc, eq, gte, inArray, isNotNull, max, ne, sql } from 'drizzle-orm';

/**
 * What wakes a flow's Lead agent (S6c, `lead_wake_events`), through the company's tenant only: an event written in the
 * transaction that made it, a flow's pending events, their outcome once told, held or let go, the wake-ups the Lead had
 * lately (the caps), the flow's last outcome and team chat (its row read only: the chats are the chats module's), and
 * the tasks whose Lead was told of them as they stand (the board).
 */

async function insert(t: TenantDb, values: TenantValues<typeof leadWakeEvents>): Promise<void> {
  await t.insert(leadWakeEvents, values);
}

/** The flow's events still waiting to be told, oldest first. */
const pendingOf = (t: TenantDb, flowId: string): Promise<LeadWakeEvent[]> =>
  t
    .select(leadWakeEvents, and(eq(leadWakeEvents.flowId, flowId), eq(leadWakeEvents.outcome, 'pending')))
    .orderBy(asc(leadWakeEvents.createdAt), asc(leadWakeEvents.id));

/** Records how these events went, while they are still pending. */
async function finish(t: TenantDb, ids: readonly string[], set: TenantSet<typeof leadWakeEvents>) {
  if (ids.length === 0) return;
  const where = and(inArray(leadWakeEvents.id, [...ids]), eq(leadWakeEvents.outcome, 'pending'));
  await t.update(leadWakeEvents, set, where);
}

/** How many wake-ups (turns) the flow's Lead had since `since`. */
async function wokeSince(t: TenantDb, flowId: string, since: Date): Promise<number> {
  const [row] = await t.selectFields(
    leadWakeEvents,
    { n: sql<number>`count(distinct ${leadWakeEvents.turnId})::int` },
    and(
      eq(leadWakeEvents.flowId, flowId),
      eq(leadWakeEvents.outcome, 'woke'),
      gte(leadWakeEvents.deliveredAt, since),
    ),
  );
  return row?.n ?? 0;
}

/** When the flow's Lead was last woken (an event's wake-up or a check-in, told); undefined before any. */
async function lastWoke(t: TenantDb, flowId: string): Promise<Date | undefined> {
  const [row] = await t.selectFields(
    leadWakeEvents,
    { at: max(leadWakeEvents.deliveredAt) },
    and(eq(leadWakeEvents.flowId, flowId), eq(leadWakeEvents.outcome, 'woke')),
  );
  return row?.at ?? undefined;
}

/** The flow's latest event that was told or held (a let-go one is passed over); undefined before any. */
async function lastOutcome(t: TenantDb, flowId: string): Promise<LeadWakeEvent | undefined> {
  const [row] = await t
    .select(
      leadWakeEvents,
      and(
        eq(leadWakeEvents.flowId, flowId),
        ne(leadWakeEvents.outcome, 'pending'),
        ne(leadWakeEvents.outcome, 'dropped'),
      ),
    )
    .orderBy(desc(leadWakeEvents.deliveredAt), desc(leadWakeEvents.id))
    .limit(1);
  return row;
}

/** The team chat the flow's Lead was last woken in, with its agent (for its page); null before any. */
async function lastChat(t: TenantDb, flowId: string): Promise<{ id: string; agentId: string } | null> {
  const [row] = await t
    .selectFields(
      leadWakeEvents,
      { chatId: leadWakeEvents.chatId },
      and(eq(leadWakeEvents.flowId, flowId), isNotNull(leadWakeEvents.chatId)),
    )
    .orderBy(desc(leadWakeEvents.deliveredAt), desc(leadWakeEvents.id))
    .limit(1);
  if (row?.chatId === null || row?.chatId === undefined) return null;
  const [chat] = await t.selectFields(
    chats,
    { id: chats.id, agentId: chats.agentId },
    eq(chats.id, row.chatId),
  );
  return chat ?? null;
}

/**
 * When the Lead was told of each of these tasks as it stands now: the task's latest event was told (`woke`) and
 * nothing happened to the task after it was written; by task id.
 */
async function toldOf(t: TenantDb, taskIds: readonly string[]): Promise<Map<string, Date>> {
  if (taskIds.length === 0) return new Map();
  const ids = [...taskIds];
  const wakes = await t
    .select(leadWakeEvents, inArray(leadWakeEvents.taskId, ids))
    .orderBy(asc(leadWakeEvents.createdAt), asc(leadWakeEvents.id));
  const moved = await t
    .selectFields(
      taskEvents,
      { taskId: taskEvents.taskId, at: max(taskEvents.createdAt) },
      inArray(taskEvents.taskId, ids),
    )
    .groupBy(taskEvents.taskId);
  const lastMove = new Map(moved.map((row) => [row.taskId, row.at]));
  const latest = new Map(wakes.flatMap((row) => (row.taskId === null ? [] : [[row.taskId, row] as const])));
  const told = new Map<string, Date>();
  for (const [taskId, row] of latest) {
    const after = lastMove.get(taskId);
    if (row.outcome !== 'woke' || row.deliveredAt === null) continue;
    if (after === undefined || after === null || row.createdAt >= after) told.set(taskId, row.deliveredAt);
  }
  return told;
}

export const wakeRows = { insert, pendingOf, finish, wokeSince, lastWoke, lastOutcome, lastChat, toldOf };
