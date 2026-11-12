import type { TenantDb } from '@mwc/db';
import type { TurnEvent } from '@mwc/shared/harness';
import { reportsRepo } from '../repo/reports.ts';
import { openQuestion } from '../rules/questions.ts';
import { type ChatStanding, chatStanding, firstBy, reportOrder } from '../rules/reports.ts';
import type { ReportChatView } from '../schemas/reports.ts';

type Standing = ChatStanding & { readonly question: boolean };

/** Where each chat stands (`chatStanding`) and whether its last turn's question is open, from two reads. */
async function standingOf(t: TenantDb, chatIds: readonly string[], viewer: string) {
  const turns = await reportsRepo.standingTurns(t, chatIds, viewer);
  const standing = chatIds.map((id) => ({
    id,
    ...chatStanding(
      turns.filter((turn) => turn.chatId === id),
      viewer,
    ),
  }));
  const lastIds = standing.flatMap((s) => (s.lastTurnId === null ? [] : [s.lastTurnId]));
  const marks = await reportsRepo.questionMarks(t, lastIds);
  const asking = (turnId: string | null) => {
    if (turnId === null) return false;
    const events = marks.filter((m) => m.turnId === turnId).map((m) => ({ event: m.event as TurnEvent }));
    return openQuestion([{ id: turnId, seq: 0, events }]) !== null;
  };
  return new Map<string, Standing>(standing.map((s) => [s.id, { ...s, question: asking(s.lastTurnId) }]));
}

/**
 * Your direct reports' chats with you (docs/harness.md "Your direct reports in the rail"): every agent (not archived)
 * that reports to the viewer on the chart, the Leads first, with its main chat with the viewer (the latest they began
 * with it, not archived, neither a task's conversation nor a team chat), where that chat stands (its last turn, a
 * running turn, an open question, its latest reply and the viewer's latest message) and, for a Lead, its flow's team
 * chat. People who report to the viewer are left out: there are no chats with people. A handful of reads, whatever the
 * number of reports.
 */
export async function reportChats(t: TenantDb, viewer: string): Promise<ReportChatView[]> {
  const agents = await reportsRepo.reportsOf(t, viewer);
  if (agents.length === 0) return [];
  const led = firstBy(
    await reportsRepo.flowsLedBy(
      t,
      agents.map((agent) => agent.principalId),
    ),
    (flow) => flow.leadPrincipalId,
  );
  const own = firstBy(
    await reportsRepo.ownChats(
      t,
      agents.map((agent) => agent.id),
      viewer,
    ),
    (chat) => chat.agentId,
  );
  const teams = firstBy(
    await reportsRepo.teamChats(
      t,
      [...led.values()].map((flow) => flow.id),
    ),
    (chat) => `${chat.flowId}:${chat.agentId}`,
  );
  const standing = await standingOf(
    t,
    [...own.values()].map((chat) => chat.id),
    viewer,
  );
  const views = agents.map((agent): ReportChatView => {
    const flow = led.get(agent.principalId);
    const chat = own.get(agent.id);
    const s = chat && (standing.get(chat.id) as Standing);
    return {
      agent,
      team: flow
        ? { flowId: flow.id, name: flow.name, chatId: teams.get(`${flow.id}:${agent.id}`)?.id ?? null }
        : null,
      chat: chat ? { id: chat.id, title: chat.title, updatedAt: chat.updatedAt.toISOString() } : null,
      lastTurn: s?.lastTurn ? { status: s.lastTurn.status, at: s.lastTurn.at.toISOString() } : null,
      working: s?.working ?? false,
      question: s?.question ?? false,
      replyAt: s?.replyAt?.toISOString() ?? null,
      messageAt: s?.messageAt?.toISOString() ?? null,
    };
  });
  return views.sort((a, b) =>
    reportOrder({ lead: a.team !== null, ...a.agent }, { lead: b.team !== null, ...b.agent }),
  );
}
