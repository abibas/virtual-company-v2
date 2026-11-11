/**
 * Tasks as plain text for `mwc task`: the list as an aligned table, one task with its history, and a move's outcome.
 * A flow's written form comes from the server as it is (`GET …/flows/:flowId/text`).
 */
import type { TaskDetail, TaskEvent, TaskMoved, TaskSummary } from '../api/tasks.ts';
import { alignRows } from '../org/render.ts';

const HEADERS = ['KEY', 'STATE', 'STEP', 'STEP STATE', 'ROUND', 'WHO', 'PRIORITY', 'TITLE'];

/** The tasks as a table, newest first, or a sentence when there are none. */
export function tasksText(tasks: readonly TaskSummary[], where: string): string {
  if (tasks.length === 0) return `No tasks ${where}.\n`;
  return alignRows([
    HEADERS,
    ...tasks.map((task) => [
      task.key,
      task.state,
      task.step?.name ?? '-',
      task.stepState ?? '-',
      task.round === null ? '-' : String(task.round),
      task.assignee?.name ?? '-',
      task.priority,
      task.title,
    ]),
  ]);
}

/** Where a task stands: `queued`, `active at QA (waiting), round 2`, `escalated from Code review`, `done`. */
export function standing(task: TaskSummary): string {
  if (task.state === 'active' && task.step) {
    return `active at ${task.step.name} (${task.stepState ?? '-'}), round ${task.round ?? 1}`;
  }
  if (task.state === 'escalated' && task.step) return `escalated from ${task.step.name}`;
  return task.state;
}

const EVENT_WORDS: Readonly<Record<string, string>> = {
  created: 'created',
  entered: 'entered',
  started: 'started',
  handed_on: 'handed on',
  passed: 'passed',
  sent_back: 'sent back',
  escalated: 'escalated',
  signed_off: 'signed off',
  routed: 'routed',
  retried: 'retried',
  done: 'done',
  cancelled: 'cancelled',
  edited: 'edited',
};

/** One history line: `2026-11-11 10:02  sent back Code review → Develop by Olga: tests fail`. */
export function eventLine(event: TaskEvent): string {
  const at = event.at.slice(0, 16).replace('T', ' ');
  const steps =
    event.from && event.to
      ? ` ${event.from.name} → ${event.to.name}`
      : event.to
        ? ` ${event.to.name}`
        : event.from
          ? ` ${event.from.name}`
          : '';
  const round = event.kind === 'entered' && event.round !== null ? ` (round ${event.round})` : '';
  const by = event.actor ? ` by ${event.actor.name}` : event.kind === 'started' ? ' by itself' : '';
  const reason = event.reason ? `: ${event.reason}` : '';
  return `${at}  ${EVENT_WORDS[event.kind] ?? event.kind}${steps}${round}${by}${reason}`;
}

/** One task: its title, flow, standing, who has it, its escalation, the caller's moves, description and history. */
export function taskText(task: TaskDetail): string {
  const lines = [
    `${task.key} · ${task.title}`,
    `Flow: ${task.flow.name} · Lead: ${task.flow.lead.name}`,
    `State: ${standing(task)} · priority ${task.priority}`,
    `Who: ${task.assignee?.name ?? '-'} · created by ${task.createdBy.name}`,
  ];
  if (task.escalation) {
    const retry = task.escalation.retryTo ? ` (a retry sends it to ${task.escalation.retryTo.name})` : '';
    lines.push(`Escalated: ${task.escalation.reason}${retry}`);
  }
  lines.push(`You may: ${task.actions.length > 0 ? task.actions.join(', ') : 'nothing'}`);
  if (task.description.trim() !== '') lines.push('', task.description.trimEnd());
  lines.push('', 'History:', ...task.history.map((event) => `  ${eventLine(event)}`));
  return `${lines.join('\n')}\n`;
}

/** A move's outcome in one line: `T-3: now active at QA (waiting), round 1`, `T-3: done`, `T-3: escalated: …`. */
export function movedText(moved: TaskMoved): string {
  const { task } = moved;
  if (moved.outcome === 'escalated')
    return `${task.key}: escalated to the Lead: ${task.escalation?.reason ?? ''}\n`;
  if (moved.outcome === 'done' || moved.outcome === 'cancelled') return `${task.key}: ${moved.outcome}\n`;
  return `${task.key}: now ${standing(task)}\n`;
}
