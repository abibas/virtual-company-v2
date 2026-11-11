import type { TaskStepState } from '@mwc/shared/enums';
import {
  type AGENT_TOOL_INPUTS,
  type DecisionAction,
  type DecisionTool,
  stepTools,
  TASK_REASON_MAX,
  type TaskDecision,
} from '@mwc/shared/flows';
import type { z } from 'zod';
import { type Refusal, refuse, roundsAt, type StepRule, type TaskNow } from '../rules.ts';
import { type IsPerson, move } from './machine.ts';
import type { StepChange } from './runs.ts';

// A step's turn's decision (S6a, docs/processes.md "Built in S6a"), pure: what a decision tool's input says, which
// steps' turns may record it, what it makes of the task (found when it is recorded, and again when the turn ends), the
// tool's answer, the round's hand-off note it leaves, and the block it makes. One decision per turn: a later call
// replaces it. The service reads the rows, records it on the task, and applies it when the turn ends.

/** A decision as its tool's checked input says it: the action, its reason and its note. */
export interface DecisionInput {
  readonly action: DecisionAction;
  readonly reason: string | null;
  readonly note: string | null;
}

type Input<T extends DecisionTool> = z.infer<(typeof AGENT_TOOL_INPUTS)[T]>;

/** What a decision tool's checked input says. */
export function decisionInput(tool: DecisionTool, input: Input<DecisionTool>): DecisionInput {
  switch (tool) {
    case 'task_hand_on':
      return { action: 'hand_on', reason: null, note: (input as Input<'task_hand_on'>).summary };
    case 'task_pass':
      return { action: 'pass', reason: null, note: (input as Input<'task_pass'>).findings ?? null };
    case 'task_approve':
      return { action: 'approve', reason: null, note: (input as Input<'task_approve'>).note ?? null };
    case 'task_send_back': {
      const { reason, findings } = input as Input<'task_send_back'>;
      return { action: 'send_back', reason, note: findings };
    }
    default:
      return { action: 'blocked', reason: (input as Input<'task_blocked'>).reason, note: null };
  }
}

/** The step's turn as a decision checks it: its step, and the agent whose turn it is. */
export interface StepTurnRef {
  readonly stepId: string;
  readonly agentPrincipalId: string;
}

const moved = refuse(409, 'task_moved', 'The task is no longer at your step: nothing was recorded.');

/**
 * Why this step's turn may not use `tool` on the task now: the task left the step (409 `task_moved`), the step is gone
 * or another's (403 `not_your_step`), or the tool is not one of the step's kind (422 `wrong_kind`).
 */
export function stepToolRefusal(
  task: TaskNow,
  step: StepRule | undefined,
  turn: StepTurnRef,
  tool: string,
): Refusal<403 | 409 | 422> | undefined {
  if (task.state !== 'active' || task.currentStepId !== turn.stepId) return moved;
  if (step === undefined || step.assigneePrincipalId !== turn.agentPrincipalId)
    return refuse(403, 'not_your_step', 'This step is no longer yours: nothing was recorded.');
  const tools = stepTools(step.kind);
  if (!(tools as string[]).includes(tool)) {
    const moves = tools.filter(
      (name) => name !== 'task_read' && name !== 'task_attach' && name !== 'task_blocked',
    );
    return refuse(
      422,
      'wrong_kind',
      `${tool} is not a move of "${step.name}", a ${step.kind} step: use ${moves.join(' or ')}.`,
    );
  }
  return undefined;
}

/** What a decision makes when the turn ends, found now: its outcome and the step it goes to. */
export interface DecisionPreview {
  readonly outcome: TaskDecision['outcome'];
  readonly to: StepRule | null;
}

/** What the decision makes of the task as it stands, or why it is not a move of it (the machine's refusals). */
export function previewDecision(
  task: TaskNow,
  steps: readonly StepRule[],
  input: DecisionInput,
  isPerson: IsPerson,
): DecisionPreview | Refusal<409 | 422> {
  if (input.action === 'blocked') return { outcome: 'blocked', to: null };
  const transition = move(task, steps, { action: input.action, reason: input.reason ?? undefined }, isPerson);
  if (!transition.ok) return transition;
  if (transition.outcome === 'escalated') {
    const target = steps.find((step) => step.id === transition.task.escalationTargetStepId) ?? null;
    return { outcome: 'escalated', to: target };
  }
  return { outcome: transition.outcome === 'done' ? 'done' : 'moved', to: transition.entered };
}

const ACTION_WORDS: Readonly<Record<DecisionAction, string>> = {
  hand_on: 'hand on',
  pass: 'pass',
  approve: 'approve',
  send_back: 'send back',
  blocked: 'blocked',
};

/** A decision's action in words (`hand on`, `send back`). */
export const actionWords = (action: DecisionAction): string => ACTION_WORDS[action];

/** What the decision makes, in the tool's words. */
function outcomeWords(
  task: TaskNow,
  step: StepRule,
  decision: DecisionInput,
  preview: DecisionPreview,
  lead: string,
) {
  const to = preview.to;
  if (preview.outcome === 'blocked')
    return `when your turn ends the task is marked blocked: ${decision.reason}`;
  if (preview.outcome === 'done') return 'when your turn ends the task is done';
  if (preview.outcome === 'escalated') {
    const times = step.sendBackLimit === 1 ? 'once' : `${step.sendBackLimit} times`;
    const back = to ? ` instead of going back to "${to.name}"` : '';
    return (
      `"${step.name}" has sent this task back ${times} already, its limit, so when your turn ends it is escalated ` +
      `to the team's Lead (${lead})${back}`
    );
  }
  if (decision.action === 'send_back' && to) {
    const round = roundsAt(task.rounds, to.id).entries + 1;
    return `when your turn ends the task goes back to "${to.name}" for round ${round}`;
  }
  return `when your turn ends the task goes to "${to?.name ?? 'the next step'}"`;
}

/** The tool's answer: what was recorded and what it makes, a replaced decision said first, then "End your turn now." */
export function decisionAnswer(
  context: { readonly task: TaskNow; readonly step: StepRule; readonly lead: string },
  decision: DecisionInput,
  preview: DecisionPreview,
  replaced: DecisionAction | null,
): string {
  const earlier = replaced === null ? '' : `This replaces your earlier decision (${actionWords(replaced)}). `;
  const what = outcomeWords(context.task, context.step, decision, preview, context.lead);
  return `${earlier}Recorded: ${what}. End your turn now.`;
}

/** The decision as the task keeps it until the turn ends. */
export function decisionRow(
  turn: { readonly turnId: string; readonly chatId: string; readonly stepId: string; readonly round: number },
  by: string,
  decision: DecisionInput,
  preview: DecisionPreview,
  at: Date,
): TaskDecision {
  return {
    turnId: turn.turnId,
    chatId: turn.chatId,
    stepId: turn.stepId,
    round: turn.round,
    action: decision.action,
    reason: decision.reason,
    note: decision.note,
    by,
    at: at.toISOString(),
    outcome: preview.outcome,
    toStepId: preview.to?.id ?? null,
    toStepName: preview.to?.name ?? null,
  };
}

/** The task's decision when it is this turn's; undefined for none or another turn's. */
export const decisionOf = (task: { readonly decision: TaskDecision | null }, turnId: string) =>
  task.decision?.turnId === turnId ? task.decision : undefined;

/**
 * The round's hand-off note a decision leaves, in place of the turn's last reply: the summary, the findings or the
 * note (a send-back's reason first); null keeps the reply (a pass or approval without words, a block).
 */
export function decisionNote(decision: TaskDecision): string | null {
  if (decision.action === 'send_back')
    return `**Sent back:** ${decision.reason}\n\n${decision.note ?? ''}`.trimEnd();
  if (decision.action === 'blocked') return null;
  return decision.note;
}

const cut = (text: string) =>
  text.length > TASK_REASON_MAX ? `${text.slice(0, TASK_REASON_MAX - 1)}…` : text;

/** The block a `task_blocked` decision makes when its turn ends, by the step's agent; undefined once the task moved. */
export function decidedBlock(task: TaskNow, step: StepRule, reason: string): StepChange | undefined {
  if (task.state !== 'active' || task.currentStepId !== step.id) return undefined;
  const why = cut(reason.trim());
  const round = roundsAt(task.rounds, step.id).entries;
  return {
    stepState: 'blocked',
    blockedReason: why,
    event: { kind: 'blocked', to: step, round, reason: why },
  };
}

/** A decision that could not be applied when its turn ended: the task waits for a person, saying why. */
export function decisionFailed(
  task: TaskNow,
  step: StepRule,
  decision: TaskDecision,
  why: string,
): StepChange {
  const round = roundsAt(task.rounds, step.id).entries;
  const reason = cut(`The agent's decision (${actionWords(decision.action)}) could not be applied: ${why}`);
  const stepState: TaskStepState = 'ended_without_handoff';
  return {
    stepState,
    blockedReason: null,
    event: { kind: 'turn_ended', system: true, to: step, round, reason },
  };
}
