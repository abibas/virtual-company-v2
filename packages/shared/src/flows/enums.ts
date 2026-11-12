import { z } from 'zod';

/**
 * The flows' and tasks' enums (S5.3a, docs/processes.md), stored as `text` columns with a CHECK like every enum of
 * `@mwc/shared/enums`, which re-exports them.
 */

/** `flow_steps.kind`: does the job, checks someone's work (a code review, QA), or a decision. */
export const FlowStepKind = z.enum(['work', 'check', 'signoff']);
export type FlowStepKind = z.infer<typeof FlowStepKind>;

/** `flow_steps.starts`: a task that enters the step starts by itself, or when someone presses Start. */
export const StepStarts = z.enum(['auto', 'manual']);
export type StepStarts = z.infer<typeof StepStarts>;

/** `flow_steps.on_return`: when the same task comes back, keep the step's conversation of it or begin a fresh one. */
export const StepOnReturn = z.enum(['keep', 'fresh']);
export type StepOnReturn = z.infer<typeof StepOnReturn>;

/** `tasks.state`: waiting to go in, at a step, with the Lead (escalated), or closed. */
export const TaskState = z.enum(['queued', 'active', 'escalated', 'done', 'cancelled']);
export type TaskState = z.infer<typeof TaskState>;

/**
 * `tasks.step_state`: how an active task stands at its step: waiting to start, being worked on, waiting for a person
 * (a question, a sign-off), blocked, or its turn ended without anyone moving it.
 */
export const TaskStepState = z.enum([
  'waiting',
  'working',
  'needs_person',
  'blocked',
  'ended_without_handoff',
]);
export type TaskStepState = z.infer<typeof TaskStepState>;

/** `tasks.priority`. */
export const TaskPriority = z.enum(['low', 'normal', 'high', 'urgent']);
export type TaskPriority = z.infer<typeof TaskPriority>;

/**
 * `task_events.kind`: every move in a task's history, and (S5.3b) what a step's run did by itself: `blocked` (its turn
 * could not start or failed, with the reason) and `turn_ended` (its turn ended and nobody moved the task yet).
 */
export const TaskEventKind = z.enum([
  'created',
  'entered',
  'started',
  'handed_on',
  'passed',
  'sent_back',
  'escalated',
  'signed_off',
  'routed',
  'retried',
  'done',
  'cancelled',
  'edited',
  'blocked',
  'turn_ended',
]);
export type TaskEventKind = z.infer<typeof TaskEventKind>;

/**
 * What a person does to a task (`POST …/tasks/{taskId}/actions`): start it at its step; the step's outcome (`hand_on`
 * for Work, `pass` or `send_back` for Check, `approve` or `send_back` for Sign-off); and the Lead's moves: `route` it
 * into a step (a queued, an active or an escalated task), `retry` an escalated one, `cancel` it.
 */
export const TaskAction = z.enum([
  'start',
  'hand_on',
  'pass',
  'approve',
  'send_back',
  'route',
  'retry',
  'cancel',
]);
export type TaskAction = z.infer<typeof TaskAction>;

/**
 * `task_artifacts.kind` (S5.3b): a file the runner collected from the step's folder, a note (the step's final reply,
 * kept as its hand-off note), a link (S6's `attach_artifact`), or a file the runner saw but did not collect (`skipped`,
 * with why: too large, not text or an image, over the count or the total).
 */
export const TaskArtifactKind = z.enum(['file', 'note', 'link', 'skipped']);
export type TaskArtifactKind = z.infer<typeof TaskArtifactKind>;

/** Why the runner left a file of the step's folder out (`turn.artifacts`, docs/runner-protocol.md "Artifacts"). */
export const ArtifactSkipReason = z.enum(['too_large', 'binary', 'too_many', 'total_limit', 'unreadable']);
export type ArtifactSkipReason = z.infer<typeof ArtifactSkipReason>;

/**
 * `lead_wake_events.kind` (S6c, docs/processes.md "Built: the Lead wakes up"): what wakes a flow's Lead agent in its team
 * chat: a task escalated to it, blocked at its step, a step's turn that ended without a hand-off, a task done (a digest),
 * or a task that has waited for a person's sign-off over the flow's hours.
 */
export const LeadWakeKind = z.enum(['escalated', 'blocked', 'turn_ended', 'done', 'signoff_waiting']);
export type LeadWakeKind = z.infer<typeof LeadWakeKind>;

/**
 * `lead_wake_events.outcome` (S6c): waiting for its quiet window (`pending`), told to the Lead in a turn of its team chat
 * (`woke`), held back by the flow's cap on wake-ups (`capped`), not told because the Lead could not run (`unreachable`: no
 * placement, no runner, no profile, paused), or let go because the task moved on first or the Lead is no agent now
 * (`dropped`).
 */
export const LeadWakeOutcome = z.enum(['pending', 'woke', 'capped', 'unreachable', 'dropped']);
export type LeadWakeOutcome = z.infer<typeof LeadWakeOutcome>;
