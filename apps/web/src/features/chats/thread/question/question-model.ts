import { ASK_TOOL_CALLS } from '@mwc/shared/chats';
import type {
  AnsweredEvent,
  ChatEvent,
  ChatTurnWithEvents,
  QuestionAnswer,
  QuestionEvent,
} from '../../../../api/types.ts';

/**
 * An agent's question in the thread (S5.2 step 4, docs/harness.md "Asking the person"): the latest `question` event
 * of a turn with the `answered` event that names it; open while its turn is the chat's last and it is not answered,
 * superseded once a newer turn came (a plain message instead). The card's draft is `draft.ts`'s. Pure.
 */

/** A turn's question: its latest `question` event, and the person's answer once given. */
export interface TurnQuestion {
  readonly event: QuestionEvent;
  readonly answered: AnsweredEvent | undefined;
}

export type QuestionStatus = 'open' | 'answered' | 'superseded';

/** A call of the question tool (Claude Code's or Codex's name): the card shows it, not a tool row. */
export const isAskCall = (name: string): boolean => (ASK_TOOL_CALLS as readonly string[]).includes(name);

/** The turn's latest question with its answer, from its events. */
export function questionOf(events: readonly ChatEvent[]): TurnQuestion | undefined {
  let event: QuestionEvent | undefined;
  for (const item of events) if (item.event.type === 'question') event = item.event;
  if (event === undefined) return undefined;
  const id = event.id;
  const answered = events.find(
    (item): item is ChatEvent & { event: AnsweredEvent } =>
      item.event.type === 'answered' && item.event.questionId === id,
  )?.event;
  return { event, answered };
}

/** Where it stands: answered, or open while its turn is the last, else superseded. */
export function questionStatus(question: TurnQuestion, lastTurn: boolean): QuestionStatus {
  if (question.answered) return 'answered';
  return lastTurn ? 'open' : 'superseded';
}

/** The turns whose prompt carried answers (the card's receipt stands for them in the thread). */
export function answerTurnIds(turns: readonly ChatTurnWithEvents[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const turn of turns) {
    for (const { event } of turn.events) if (event.type === 'answered') ids.add(event.turnId);
  }
  return ids;
}

/** One question's answer in words: its picks, then the person's own; neither: skipped. */
export function answerWords(answer: Pick<QuestionAnswer, 'picked' | 'other'> | undefined): string {
  const parts = answer?.picked.length ? [answer.picked.join(', ')] : [];
  if (answer?.other) parts.push(answer.other);
  return parts.length === 0 ? 'Skipped' : parts.join('; ');
}
