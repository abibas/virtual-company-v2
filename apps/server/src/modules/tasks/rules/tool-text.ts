import { clipText, newTasksWords, TOOL_RESULT_MAX } from '@mwc/shared/flows';
import type { BoardView } from '../schemas/board.ts';
import type { TaskDecisionView, TaskDetailView, TaskEventView, TaskSummaryView } from '../schemas/tasks.ts';
import { actionWords } from './decision.ts';

// What the agents' tools answer (S6a), pure: the board, a task, where a task is now, a move made, a task made, an
// artifact kept. Plain text an agent reads, short, and never over a tool answer's limit.

/** How much of a task's description `task_show` quotes. */
export const SHOWN_DESCRIPTION_MAX = 4_000;

/** How many of a task's latest history rows `task_show` lists. */
export const SHOWN_HISTORY = 15;

const KIND_WORDS = { work: 'Work', check: 'Check', signoff: 'Sign-off' } as const;

const STATE_WORDS: Readonly<Record<string, string>> = {
  waiting: 'waiting to start',
  working: 'working',
  needs_person: 'waiting for a person',
  blocked: 'blocked',
  ended_without_handoff: 'its turn ended without a move',
};

/** A task's step state in words. */
const stateWords = (state: string | null) => (state === null ? '' : (STATE_WORDS[state] ?? state));

/** What a task waits for (T-39): `waits for T-5, T-6 (done)`; empty for nothing. */
const waitsWords = (waits: readonly { readonly key: string; readonly closed: boolean }[]) =>
  waits.length === 0
    ? ''
    : `waits for ${waits.map((wait) => (wait.closed ? `${wait.key} (closed)` : wait.key)).join(', ')}`;

/**
 * One card's line: `- T-12 · Fix the login · working · round 2 · high`; a queued one starts with its place and says
 * Autotake or Manual and what it waits for (T-39): `- 1. T-12 · Fix the login · autotake · waits for T-11`.
 */
function cardLine(card: BoardView['columns'][number]['cards'][number], queued = false, place = 0): string {
  const parts = [queued ? `${place}. ${card.key}` : card.key, card.title];
  if (card.cancelled) parts.push('cancelled');
  if (card.stepState !== null) parts.push(stateWords(card.stepState));
  if (card.stepState === 'blocked' && card.blockedReason) parts.push(`why: ${card.blockedReason}`);
  if (card.round !== null && card.round > 1) parts.push(`round ${card.round}`);
  if (card.priority !== 'normal') parts.push(card.priority);
  if (queued) parts.push(card.autoTake ? 'autotake' : 'manual');
  if (queued && card.waitsFor.length > 0) parts.push(waitsWords(card.waitsFor));
  return `- ${parts.join(' · ')}`;
}

/** The current sprint (T-37): `Current sprint: "Sprint 4 · Mon 16 Nov" · since 2026-11-16 08:30 UTC · …`. */
function sprintLine(sprint: BoardView['sprint']): string {
  const plain = `Sprint ${sprint.number}`;
  const name = sprint.name.startsWith(plain) ? `"${sprint.name}"` : `${plain} "${sprint.name}"`;
  const since = `${sprint.startedAt.slice(0, 16).replace('T', ' ')} UTC`;
  return `Current sprint: ${name} · since ${since} · Done lists only this sprint's closed tasks`;
}

/**
 * The board as `team_board` answers it: the flow and its defaults for new tasks (T-38), its current sprint (T-37), then
 * each column with its cards.
 */
export function boardText(board: BoardView): string {
  const into = board.columns.find((column) => column.step?.id === board.flow.newTaskStepId);
  const stepName = board.flow.newTaskStepId === null ? null : (into?.title ?? null);
  const newTasks = newTasksWords({ stepName, autoTake: board.flow.newTaskAutoTake });
  const lines = [
    `Flow "${board.flow.name}" · Lead: ${board.flow.lead.name} · new tasks: ${newTasks}`,
    sprintLine(board.sprint),
  ];
  for (const column of board.columns) {
    const who = column.step ? ` · ${KIND_WORDS[column.step.kind]} · ${column.step.assignee.name}` : '';
    const count = column.kind === 'done' ? `${column.cards.length} of ${column.total}` : `${column.total}`;
    const cards = column.cards.map((card, index) => cardLine(card, column.kind === 'queued', index + 1));
    lines.push('', `${column.title}${who} (${count})`, ...cards);
  }
  return clipText(lines.join('\n'), TOOL_RESULT_MAX);
}

/** Where a task is: `active at "Develop" (working), round 2`, `queued`, `done`. */
export function whereText(task: Pick<TaskSummaryView, 'state' | 'step' | 'stepState' | 'round'>): string {
  if (task.state === 'active' && task.step) {
    const round = task.round === null ? '' : `, round ${task.round}`;
    return `active at "${task.step.name}" (${stateWords(task.stepState)})${round}`;
  }
  if (task.state === 'escalated' && task.step) return `escalated to the team's Lead from "${task.step.name}"`;
  return task.state;
}

/** A recorded decision in words: `Developer will hand on to "Code review"`. */
export function decisionText(decision: TaskDecisionView): string {
  const who = decision.by.name;
  if (decision.outcome === 'blocked')
    return `${who} will mark it blocked: ${decision.reason ?? ''}`.trimEnd();
  if (decision.outcome === 'done')
    return `${who} will ${actionWords(decision.action)}: the task is then done`;
  if (decision.outcome === 'escalated')
    return `${who} will send it back over the limit: it then goes to the Lead`;
  return `${who} will ${actionWords(decision.action)} to "${decision.to?.name ?? 'the next step'}"`;
}

/** One history row: `- 2026-11-11 10:04 · sent back from "Code review" to "Develop" by Code Reviewer: why`. */
function historyLine(event: TaskEventView): string {
  const when = event.at.slice(0, 16).replace('T', ' ');
  const from = event.from ? ` from "${event.from.name}"` : '';
  const to = event.to ? ` to "${event.to.name}"` : '';
  const by = event.actor ? ` by ${event.actor.name}` : '';
  const why = event.reason ? `: ${event.reason.replace(/\s+/g, ' ').slice(0, 300)}` : '';
  return `- ${when} · ${event.kind.replace(/_/g, ' ')}${from}${to}${by}${why}`;
}

/** A task's waits for in words: `waits for T-5 (active), T-6 (done)`; empty for none. */
const waitsForWords = (task: Pick<TaskDetailView, 'waitsFor'>) =>
  task.waitsFor.length === 0
    ? ''
    : `waits for ${task.waitsFor.map((wait) => `${wait.key} (${wait.state})`).join(', ')}`;

/**
 * A queued task's place, Autotake and waits (T-39): `Queue: 2 of 5 · Autotake · waits for T-11 (active)`; for a task
 * not queued only what it waits for, if anything.
 */
function queueFacts(task: Pick<TaskDetailView, 'queue' | 'autoTake' | 'waitsFor'>): string {
  const waits = waitsForWords(task);
  if (task.queue === null) return waits === '' ? '' : `Waits for: ${waits.slice('waits for '.length)}`;
  const parts = [`Queue: ${task.queue.place} of ${task.queue.of}`, task.autoTake ? 'Autotake' : 'Manual'];
  if (waits) parts.push(waits);
  return parts.join(' · ');
}

/** A task as `task_show` answers it: where it is, who has it, its description, its latest history. */
export function taskText(task: TaskDetailView): string {
  const facts = [
    `State: ${whereText(task)} · priority ${task.priority}`,
    `Has it: ${task.assignee?.name ?? 'nobody'} · flow ${task.flow.name} · made by ${task.createdBy.name}`,
  ];
  const queue = queueFacts(task);
  if (queue) facts.push(queue);
  if (task.blockedReason) facts.push(`Blocked: ${task.blockedReason}`);
  if (task.escalation) {
    const retry = task.escalation.retryTo ? `; a retry goes to "${task.escalation.retryTo.name}"` : '';
    facts.push(`Escalated: ${task.escalation.reason}${retry}`);
  }
  if (task.decision) facts.push(`Decision in the running turn: ${decisionText(task.decision)}`);
  facts.push(`Artifacts: ${task.artifacts} · conversations: ${task.conversations.length}`);
  const description = task.description.trim() === '' ? '(no description)' : task.description.trim();
  const history = task.history.slice(-SHOWN_HISTORY).map(historyLine);
  const text = [
    `# ${task.key} · ${task.title}`,
    facts.join('\n'),
    `## Description\n\n${clipText(description, SHOWN_DESCRIPTION_MAX)}`,
    `## History (latest ${history.length} of ${task.history.length})\n\n${history.join('\n')}`,
  ].join('\n\n');
  return clipText(text, TOOL_RESULT_MAX);
}

const OUTCOME_WORDS: Readonly<Record<string, string>> = {
  started: 'started',
  moved: 'moved',
  done: 'done',
  escalated: 'escalated',
  cancelled: 'cancelled',
};

/** What a Lead's move did: `Done: T-12 is now active at "Develop" (working), round 1.` */
export function movedText(outcome: string, task: TaskSummaryView): string {
  if (outcome === 'done' || outcome === 'cancelled') return `Done: ${task.key} is ${OUTCOME_WORDS[outcome]}.`;
  return `Done: ${task.key} is now ${whereText(task)}.`;
}

/**
 * A task the Lead made: `Created T-13 "Fix the docs": queued.`, and a queued one's place, Autotake and waits (T-39):
 * `Created T-13 "Fix the docs": queued (Queue: 3 of 3 · Manual · waits for T-12 (queued)).`
 */
export const createdText = (task: TaskDetailView): string => {
  const queue = queueFacts(task);
  return `Created ${task.key} "${task.title}": ${whereText(task)}${queue ? ` (${queue})` : ''}.`;
};

/** A queued task the Lead planned (T-39): `Done: T-13 · Queue: 1 of 3 · Autotake · priority high · waits for T-12 (done).` */
export const queuedText = (task: TaskDetailView): string =>
  `Done: ${[`${task.key} is ${whereText(task)}`, queueFacts(task), `priority ${task.priority}`].filter(Boolean).join(' · ')}.`;

/** An artifact kept: `Attached "QA report" to T-12 (Develop, round 1) as a note.` */
export const attachedText = (
  name: string,
  kind: 'note' | 'file' | 'link',
  at: { readonly key: string; readonly step: string; readonly round: number },
): string => `Attached "${name}" to ${at.key} (${at.step}, round ${at.round}) as a ${kind}.`;
