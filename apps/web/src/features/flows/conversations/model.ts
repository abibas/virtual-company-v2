import type { TaskDetail } from '../../../api/flows.ts';
import type { Tone } from '../../../components/ui/Badge.tsx';

/**
 * A task's conversations as its page lists them (S5.3b): each one's state from its turns, the rounds it covers (a
 * Keep step's one conversation spans its rounds, a Fresh step has one per round), their order, and the one the page
 * opens first.
 */

export type TaskConversation = TaskDetail['conversations'][number];

export interface ConversationLook {
  readonly label: string;
  readonly tone: Tone;
  /** A turn runs (or waits behind one): the dot pulses. */
  readonly live: boolean;
}

/** Running, Queued, Ended, Stopped, Failed, or Not started before its first turn. */
export function conversationLook(conversation: TaskConversation): ConversationLook {
  switch (conversation.lastTurn?.status) {
    case undefined:
      return { label: 'Not started', tone: 'pending', live: false };
    case 'running':
      return { label: 'Running', tone: 'blue', live: true };
    case 'queued':
      return { label: 'Queued', tone: 'pending', live: true };
    case 'done':
      return { label: 'Ended', tone: 'done', live: false };
    case 'stopped':
      return { label: 'Stopped', tone: 'input', live: false };
    case 'failed':
      return { label: 'Failed', tone: 'failed', live: false };
  }
}

export interface RoundSpan {
  readonly from: number;
  readonly to: number;
}

/**
 * The rounds each conversation covers: from the round it began in up to the round before the step's next
 * conversation began, the last one up to the step's rounds so far.
 */
export function roundSpans(task: TaskDetail): ReadonlyMap<string, RoundSpan> {
  const entries = new Map(task.rounds.map((r) => [r.step.id, r.entries]));
  const spans = new Map<string, RoundSpan>();
  const byStep = Map.groupBy(task.conversations, (c) => c.step.id);
  for (const [stepId, list] of byStep) {
    const sorted = list.toSorted((a, b) => a.round - b.round);
    sorted.forEach((c, i) => {
      const next = sorted[i + 1];
      const last = next ? next.round - 1 : (entries.get(stepId) ?? c.round);
      spans.set(c.chatId, { from: c.round, to: Math.max(c.round, last) });
    });
  }
  return spans;
}

/** "Round 2", "Rounds 1–3". */
export const roundWords = ({ from, to }: RoundSpan): string =>
  from === to ? `Round ${from}` : `Rounds ${from}–${to}`;

/** The conversations in the flow's order of their steps (a removed step's last), then by round. */
export function inStepOrder(task: TaskDetail, stepIds: readonly string[]): TaskConversation[] {
  const at = (id: string) => {
    const index = stepIds.indexOf(id);
    return index < 0 ? stepIds.length : index;
  };
  return task.conversations.toSorted((a, b) => at(a.step.id) - at(b.step.id) || a.round - b.round);
}

/** The conversation the page opens first: the current step's latest, else the latest of all. */
export function firstOpen(task: TaskDetail): string | undefined {
  const latest = (list: readonly TaskConversation[]) =>
    list.toSorted((a, b) => a.round - b.round || a.createdAt.localeCompare(b.createdAt)).at(-1);
  const here = task.step ? latest(task.conversations.filter((c) => c.step.id === task.step?.id)) : undefined;
  return (here ?? task.conversations.at(-1))?.chatId;
}
