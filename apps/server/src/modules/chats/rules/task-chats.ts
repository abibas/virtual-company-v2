/**
 * A task's conversations as an agent's chats name them (2026-11-14, T-19; docs/harness.md "Task conversations in the
 * agent's chats"), pure: the rounds of its step a conversation covers, as the task's page counts them. A Keep step
 * continues its latest conversation round after round, a Fresh step begins one per round, and different steps never
 * share one.
 */

/** How many of an agent's task conversations its chat list holds, the latest first. */
export const AGENT_TASK_CHATS = 50;

/** A conversation of a task at a step, and the round of the step it began in. */
export interface StepConversation {
  readonly id: string;
  readonly stepId: string;
  readonly round: number;
}

export interface RoundSpan {
  readonly from: number;
  readonly to: number;
}

/**
 * The rounds `chat` covers among the task's conversations (`all`, oldest first, the chat among them): from the round it
 * began in up to the round before the step's next conversation began; the step's latest one up to `entries`, the times
 * the task has entered the step so far. Never below the round it began in (a new conversation in the same round: the
 * agent moved to another machine, or the last one was archived).
 */
export function roundSpanOf(
  chat: StepConversation,
  all: readonly StepConversation[],
  entries: number,
): RoundSpan {
  const step = all.filter((other) => other.stepId === chat.stepId);
  const next = step[step.findIndex((other) => other.id === chat.id) + 1];
  const last = next === undefined ? entries : next.round - 1;
  return { from: chat.round, to: Math.max(chat.round, last) };
}
