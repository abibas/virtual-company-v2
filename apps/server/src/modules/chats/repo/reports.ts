import { agents, chatEvents, chats, chatTurns, flows, orgPositions, type TenantDb } from '@mwc/db';
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';

/**
 * What the rail's Chats read (docs/harness.md "Your direct reports in the rail"), read only: the agents that report to a
 * person on the chart (the org module's rows), the flows they lead, their chats with that person and the team chats,
 * and the few turns and events that say where each chat stands.
 */

/** The agents (not archived) whose place on the chart reports to this principal. */
async function reportsOf(t: TenantDb, principalId: string) {
  const placed = await t.selectFields(
    orgPositions,
    { principalId: orgPositions.principalId },
    eq(orgPositions.reportsToPrincipalId, principalId),
  );
  if (placed.length === 0) return [];
  return t.selectFields(
    agents,
    {
      id: agents.id,
      principalId: agents.principalId,
      name: agents.name,
      slug: agents.slug,
      roleTitle: agents.roleTitle,
      status: agents.status,
    },
    and(
      inArray(
        agents.principalId,
        placed.map((p) => p.principalId),
      ),
      ne(agents.status, 'archived'),
    ),
  );
}

/** The flows these principals (at least one) lead, one each. */
const flowsLedBy = (t: TenantDb, principalIds: readonly string[]) =>
  t.selectFields(
    flows,
    { id: flows.id, name: flows.name, leadPrincipalId: flows.leadPrincipalId },
    inArray(flows.leadPrincipalId, [...principalIds]),
  );

/**
 * The chats this principal began with these agents (at least one), not archived, neither a task's conversation nor a
 * team chat, the latest first (by `updated_at`, which a sent message moves, as the agent's chat list orders them).
 */
const ownChats = (t: TenantDb, agentIds: readonly string[], principalId: string) =>
  t
    .selectFields(
      chats,
      { id: chats.id, agentId: chats.agentId, title: chats.title, updatedAt: chats.updatedAt },
      and(
        inArray(chats.agentId, [...agentIds]),
        eq(chats.createdBy, principalId),
        isNull(chats.taskId),
        isNull(chats.flowId),
        isNull(chats.archivedAt),
      ),
    )
    .orderBy(desc(chats.updatedAt), desc(chats.id));

/** These flows' team chats, not archived, the latest first (S6c: one goes on per flow and Lead). */
const teamChats = (t: TenantDb, flowIds: readonly string[]) =>
  flowIds.length === 0
    ? Promise.resolve([])
    : t
        .selectFields(
          chats,
          { id: chats.id, flowId: chats.flowId, agentId: chats.agentId },
          and(inArray(chats.flowId, [...flowIds]), isNull(chats.archivedAt)),
        )
        .orderBy(desc(chats.createdAt), desc(chats.id));

/** The highest `seq` of the row's chat among the turns matching `filter` (a correlated subquery). */
const latestSeq = (filter: ReturnType<typeof sql>) =>
  sql`${chatTurns.seq} = (select max(l.seq) from chat_turns l where l.company_id = ${chatTurns.companyId} and l.chat_id = ${chatTurns.chatId} and ${filter})`;

/**
 * The turns that say where each chat stands: its last turn, its running ones, its latest reply (a message turn that is
 * done) and the latest message this principal wrote in it.
 */
const standingTurns = (t: TenantDb, chatIds: readonly string[], principalId: string) =>
  chatIds.length === 0
    ? Promise.resolve([])
    : t.selectFields(
        chatTurns,
        {
          id: chatTurns.id,
          chatId: chatTurns.chatId,
          seq: chatTurns.seq,
          kind: chatTurns.kind,
          status: chatTurns.status,
          system: chatTurns.system,
          createdBy: chatTurns.createdBy,
          createdAt: chatTurns.createdAt,
          startedAt: chatTurns.startedAt,
          endedAt: chatTurns.endedAt,
        },
        and(
          inArray(chatTurns.chatId, [...chatIds]),
          or(
            latestSeq(sql`true`),
            eq(chatTurns.status, 'running'),
            latestSeq(sql`l.kind = 'message' and l.status = 'done'`),
            latestSeq(sql`l.kind = 'message' and not l.system and l.created_by = ${principalId}`),
          ),
        ),
      );

/** The `question` and `answered` events of these turns, in order. */
const questionMarks = (t: TenantDb, turnIds: readonly string[]) =>
  turnIds.length === 0
    ? Promise.resolve([])
    : t
        .selectFields(
          chatEvents,
          { turnId: chatEvents.turnId, event: chatEvents.event },
          and(
            inArray(chatEvents.turnId, [...turnIds]),
            sql`${chatEvents.event}->>'type' in ('question', 'answered')`,
          ),
        )
        .orderBy(asc(chatEvents.seq));

export const reportsRepo = { reportsOf, flowsLedBy, ownChats, teamChats, standingTurns, questionMarks };
