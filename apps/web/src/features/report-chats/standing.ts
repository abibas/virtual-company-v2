import type { ReportChat } from '../../api/report-chats.ts';
import type { AgentRef } from '../../components/feed/kinds.ts';
import { seenSince } from './seen.ts';

/** A direct report's dot: a question waits (amber), a turn runs (pulsing), a reply you have not seen (blue), or none. */
export type ReportDot = 'question' | 'working' | 'unseen' | null;

/** A direct report as the rail draws it: the server's row, the agent's face, and its dot. */
export interface RailReport {
  readonly report: ReportChat;
  readonly face: AgentRef;
  readonly dot: ReportDot;
}

/** The dot's words, for the tooltip and screen readers. */
export const DOT_WORDS: Readonly<Record<Exclude<ReportDot, null>, string>> = {
  question: 'asks you something',
  working: 'working',
  unseen: 'replied',
};

/**
 * The report's dot: an open question first, then a running turn, then a reply that ended after both your last message
 * in the chat and what this browser has seen of it.
 */
export function dotOf(report: ReportChat): ReportDot {
  if (report.question) return 'question';
  if (report.working) return 'working';
  const { chat, replyAt, messageAt } = report;
  if (chat === null || replyAt === null) return null;
  const reply = Date.parse(replyAt);
  const wrote = messageAt === null ? 0 : Date.parse(messageAt);
  return reply > wrote && reply > seenSince(chat.id) ? 'unseen' : null;
}

/** The rail's reports with their faces (the company's agents' icons, else the name alone) and dots. */
export function railReports(
  reports: readonly ReportChat[],
  faces: ReadonlyMap<string, AgentRef>,
): readonly RailReport[] {
  return reports.map((report) => ({
    report,
    face: faces.get(report.agent.principalId) ?? {
      id: report.agent.id,
      name: report.agent.name,
      role: report.agent.roleTitle,
    },
    dot: dotOf(report),
  }));
}

/** How many reports wait for you: a question or a reply you have not seen (the Chats tab's count). */
export const waitingCount = (reports: readonly RailReport[]): number =>
  reports.filter((r) => r.dot === 'question' || r.dot === 'unseen').length;

/** "Name · role", and what its dot says. */
export function reportLabel(r: RailReport): string {
  const base = `${r.report.agent.name} · ${r.report.agent.roleTitle}`;
  return r.dot ? `${base} (${DOT_WORDS[r.dot]})` : base;
}
