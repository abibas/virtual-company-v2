import type { FlowStepKind, MembershipRole, TaskEventKind, TaskPriority } from '@mwc/shared/enums';
import { roleAtLeast } from '@mwc/shared/roles';
import type { InboxKind } from './schemas.ts';

// The inbox's pure rules (S6b, docs/processes.md "Built in S6b"): which open task needs the viewer and as what, who may
// answer an agent's question, which history row says who handed the task on, and the order, the most urgent first.
// Who leads a team is the S5.3a rule: the Lead's people, the Lead when a person and every person above it on the chart.

/** A task as the inbox reads it. */
export interface TaskLook {
  readonly state: string;
  readonly stepState: string | null;
}

/** Its step as the inbox reads it. */
export interface StepLook {
  readonly kind: FlowStepKind;
  readonly assigneePrincipalId: string;
}

/** Who looks: their principal, their role, and whether they are one of the task's team's Lead people. */
export interface Viewer {
  readonly principalId: string;
  readonly role: MembershipRole;
}

/**
 * What the task asks of the viewer, or undefined for nothing. Viewers (the role) make no moves, so nothing needs them.
 * - escalated: for the Lead's people;
 * - active and `blocked` or `ended_without_handoff`: for the Lead's people and the step's assignee;
 * - active at the viewer's own step otherwise: a Sign-off, or another step of theirs (a person's step runs nothing, so it
 *   waits for them whatever its state).
 */
export function taskKind(
  viewer: Viewer,
  task: TaskLook,
  step: StepLook | undefined,
  leadPeople: readonly string[],
): InboxKind | undefined {
  if (!roleAtLeast(viewer.role, 'member')) return undefined;
  const leads = leadPeople.includes(viewer.principalId);
  if (task.state === 'escalated') return leads ? 'escalated' : undefined;
  if (task.state !== 'active' || step === undefined) return undefined;
  const mine = step.assigneePrincipalId === viewer.principalId;
  if (task.stepState === 'blocked') return leads || mine ? 'blocked' : undefined;
  if (task.stepState === 'ended_without_handoff') return leads || mine ? 'turn_ended' : undefined;
  if (!mine) return undefined;
  return step.kind === 'signoff' ? 'signoff' : 'step';
}

/** True when the viewer may answer an agent's question: admins and owners, as `POST …/chats/{chatId}/answers` allows. */
export const answersQuestions = (role: MembershipRole): boolean => roleAtLeast(role, 'admin');

/** History rows that only follow a move (or edit the task) and say nothing of who handed it on. */
const QUIET: ReadonlySet<TaskEventKind> = new Set(['entered', 'started', 'edited']);

/** The latest history row that moved or stopped the task (oldest first in, `undefined` for none). */
export function lastMove<E extends { readonly kind: TaskEventKind }>(events: readonly E[]): E | undefined {
  return events.findLast((event) => !QUIET.has(event.kind));
}

/** What needs the viewer most first: what only they decide, then what is stuck. */
export const KIND_RANK: Readonly<Record<InboxKind, number>> = {
  signoff: 0,
  question: 1,
  step: 2,
  escalated: 3,
  blocked: 4,
  turn_ended: 5,
};

const PRIORITY_RANK: Readonly<Record<TaskPriority, number>> = { urgent: 0, high: 1, normal: 2, low: 3 };

/** An item as the order reads it; a question counts as a normal task. */
export interface Ranked {
  readonly kind: InboxKind;
  readonly priority: TaskPriority | null;
  readonly at: string;
}

/** The order of the items: the task's priority (urgent first), then the kind (`KIND_RANK`), then the longest waiting. */
export const byUrgency = (a: Ranked, b: Ranked): number =>
  PRIORITY_RANK[a.priority ?? 'normal'] - PRIORITY_RANK[b.priority ?? 'normal'] ||
  KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
  a.at.localeCompare(b.at);
