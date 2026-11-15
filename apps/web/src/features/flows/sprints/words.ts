import type { Board, Sprint } from '../../../api/flows.ts';
import { PRIORITY } from '../words.ts';

// A flow's sprints in words (T-37): their dates, their titles, the New sprint question and a report as Markdown.

const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** "Mon 16 Nov". */
export const sprintDay = (at: string | Date): string => DAY.format(new Date(at)).replace(',', '');

/** "Mon 16 Nov, 08:30". */
export const sprintMoment = (at: string | Date): string => `${sprintDay(at)}, ${TIME.format(new Date(at))}`;

/** A new sprint's name unless one is typed: "Sprint 4 · Mon 16 Nov" (today, in the person's own time zone). */
export const defaultSprintName = (number: number, at: Date = new Date()): string =>
  `Sprint ${number} · ${sprintDay(at)}`;

/** "Sprint 4", with a name of its own after it ("Sprint 4 · Release push"); the default name adds nothing. */
export function sprintTitle(sprint: { readonly number: number; readonly name: string }): string {
  const plain = `Sprint ${sprint.number}`;
  return sprint.name.startsWith(plain) ? plain : `${plain} · ${sprint.name}`;
}

/** The board's header: "Sprint 4 · since Mon 16 Nov, 08:30". */
export const sprintSince = (sprint: Board['sprint']): string =>
  `${sprintTitle(sprint)} · since ${sprintMoment(sprint.startedAt)}`;

/** How many open tasks the board has: queued, in progress (at a step), escalated. */
export function openCounts(board: Board): { queued: number; inProgress: number; escalated: number } {
  const total = (kind: Board['columns'][number]['kind']) =>
    board.columns.filter((column) => column.kind === kind).reduce((sum, column) => sum + column.total, 0);
  return { queued: total('queued'), inProgress: total('step'), escalated: total('escalated') };
}

/** "2 queued, 1 in progress and 1 escalated", or null for none. */
function openWords(open: ReturnType<typeof openCounts>): string | null {
  const parts = [
    open.queued > 0 ? `${open.queued} queued` : '',
    open.inProgress > 0 ? `${open.inProgress} in progress` : '',
    open.escalated > 0 ? `${open.escalated} escalated` : '',
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return parts.length === 1 ? (parts[0] as string) : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/**
 * The New sprint question: "End Sprint 3 (since Sun 15 Nov, 09:12)? 12 done, 2 cancelled. 2 queued and 1 in progress
 * carry over to Sprint 4."
 */
export function endQuestion(board: Board): string {
  const { sprint } = board;
  const open = openWords(openCounts(board));
  const next = `Sprint ${sprint.number + 1}`;
  const carried = open === null ? `Nothing open carries over to ${next}.` : `${open} carry over to ${next}.`;
  return `End ${sprintTitle(sprint)} (since ${sprintMoment(sprint.startedAt)})? ${sprint.done} done, ${sprint.cancelled} cancelled. ${carried}`;
}

type ReportTask = Sprint['report']['done'][number];

const closedLine = (task: ReportTask) => {
  const priority = task.priority === 'normal' ? '' : ` (${PRIORITY[task.priority].label.toLowerCase()})`;
  return `- **${task.key}** ${task.title}${priority} · closed ${sprintMoment(task.closedAt)}`;
};

/** A sprint's report as Markdown, to paste anywhere: its dates, Done, Cancelled, Carried over and how many were made. */
export function sprintMarkdown(sprint: Sprint, flowName: string): string {
  const { report } = sprint;
  const ended = sprint.endedAt
    ? `ended ${sprintMoment(sprint.endedAt)}${sprint.endedBy ? ` by ${sprint.endedBy.name}` : ''}`
    : 'still running (the report so far)';
  const carriedTitle = sprint.current ? 'Open now (would carry over)' : 'Carried over';
  const section = (title: string, lines: readonly string[]) => [
    '',
    `## ${title} (${lines.length})`,
    ...(lines.length === 0 ? ['- none'] : lines),
  ];
  return [
    `# ${flowName} · ${sprint.name}`,
    '',
    `Started ${sprintMoment(sprint.startedAt)} by ${sprint.startedBy.name} · ${ended}`,
    ...section('Done', report.done.map(closedLine)),
    ...section('Cancelled', report.cancelled.map(closedLine)),
    ...section(
      carriedTitle,
      report.carriedOver.map((task) => `- **${task.key}** ${task.title} · ${task.where}`),
    ),
    '',
    `Created in it: ${report.created}`,
  ].join('\n');
}
