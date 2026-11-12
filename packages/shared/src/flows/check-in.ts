import type { TaskStepState } from './enums.ts';
import { clipLine, LEAD_WAKE_LISTED, LEAD_WAKE_REASON_MAX, LEAD_WAKE_TITLE_MAX } from './wake.ts';

/**
 * A flow Lead's regular check-in (docs/processes.md "Check-ins"): while its flow has work, Most Wanted wakes the Lead
 * every few minutes in its team chat with a compact digest of the board, so it can act without calling a tool first.
 * Per open task: its key and title, its step and step state, how long it has been so, and whether a turn is on it; a
 * step marked working with no turn, or a blocked one, is stuck and listed first. Pure.
 */

/** Whether a turn is on a task: running, waiting to start (behind another, for a free slot, for its machine), none. */
export type CheckInTurn = 'live' | 'waiting' | 'none';

/** One open task as a check-in tells it. */
export interface LeadCheckInTask {
  readonly task: { readonly key: string; readonly title: string };
  readonly state: 'active' | 'escalated';
  /** The step it is at (escalated: the one it came from, when known); null for none. */
  readonly step: string | null;
  readonly stepState: TaskStepState | null;
  /** Minutes since it came to this state (its latest history row). */
  readonly minutes: number;
  readonly turn: CheckInTurn;
  /** Why it is blocked or escalated, when it is. */
  readonly reason: string | null;
}

export interface LeadCheckInInput {
  readonly flow: string;
  readonly tasks: readonly LeadCheckInTask[];
}

/** How a check-in ends: act only where needed, then end the turn rather than wait. */
export const LEAD_CHECK_IN_CLOSING =
  'Act only where a task needs you, then end your turn: never wait for a step’s agent, Most Wanted checks in ' +
  'again. task_show and team_board have more. If all is on track, reply “On track”.';

/** True for a task nobody is moving: blocked, or marked working with no turn on it. */
export const isStuck = (task: Pick<LeadCheckInTask, 'state' | 'stepState' | 'turn'>): boolean =>
  task.state === 'active' &&
  (task.stepState === 'blocked' || (task.stepState === 'working' && task.turn === 'none'));

const STEP_STATE_WORDS: Readonly<Record<TaskStepState, string>> = {
  waiting: 'waiting to start',
  working: 'working',
  needs_person: 'waiting for a person',
  blocked: 'blocked',
  ended_without_handoff: 'ended without a hand-off',
};

const TURN_WORDS: Readonly<Record<CheckInTurn, string>> = {
  live: 'turn live',
  waiting: 'turn waiting to start',
  none: 'no turn',
};

/** A duration in words: "under a minute", "12 min", "2 h 5 min", "3 d 4 h". */
export function durationWords(minutes: number): string {
  const whole = Math.max(0, Math.floor(minutes));
  if (whole < 1) return 'under a minute';
  if (whole < 60) return `${whole} min`;
  const hours = Math.floor(whole / 60);
  if (hours < 24) return whole % 60 === 0 ? `${hours} h` : `${hours} h ${whole % 60} min`;
  const days = Math.floor(hours / 24);
  return hours % 24 === 0 ? `${days} d` : `${days} d ${hours % 24} h`;
}

/** One task's line: key and title, step, state and how long, the turn when it matters, and why. */
function taskLine(item: LeadCheckInTask): string {
  const parts = [`${item.task.key} “${clipLine(item.task.title, LEAD_WAKE_TITLE_MAX)}”`];
  if (item.step !== null) parts.push(item.step);
  const state = item.state === 'escalated' ? 'escalated' : STEP_STATE_WORDS[item.stepState ?? 'waiting'];
  parts.push(`${state} ${durationWords(item.minutes)}`);
  if (item.stepState === 'working' || item.turn !== 'none') parts.push(TURN_WORDS[item.turn]);
  const stuck = isStuck(item) && item.stepState === 'working' ? ' (stuck)' : '';
  const reason = item.reason?.trim() ?? '';
  return `- ${parts.join(' · ')}${stuck}${reason === '' ? '' : `: ${clipLine(reason, LEAD_WAKE_REASON_MAX)}`}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The check-in's message (see above): a headline with the open and stuck counts, one line per task (the stuck ones
 * first, at most `LEAD_WAKE_LISTED`, the rest counted) and a closing line. No tasks make an empty string.
 */
export function leadCheckInMessage(input: LeadCheckInInput): string {
  if (input.tasks.length === 0) return '';
  const stuck = input.tasks.filter(isStuck);
  const ordered = [...stuck, ...input.tasks.filter((task) => !isStuck(task))];
  const listed = ordered.slice(0, LEAD_WAKE_LISTED);
  const counts = `${plural(input.tasks.length, 'open task', 'open tasks')}${stuck.length > 0 ? ` (${stuck.length} stuck)` : ''}`;
  const lines = [
    `Most Wanted · ${clipLine(input.flow, 80)}: check-in, ${counts}.`,
    '',
    ...listed.map(taskLine),
  ];
  const hidden = ordered.length - listed.length;
  if (hidden > 0) lines.push(`- And ${plural(hidden, 'more task', 'more tasks')}: team_board lists them.`);
  lines.push('', LEAD_CHECK_IN_CLOSING);
  return lines.join('\n');
}
