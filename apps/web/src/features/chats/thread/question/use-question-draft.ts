import { useCallback, useState } from 'react';
import type { QuestionAnswer } from '../../../../api/types.ts';
import { type DraftAnswer, EMPTY_DRAFT } from './draft.ts';

/**
 * A question card's state, kept while the page lives (S5.2 step 4): the page it shows, the draft of each question and
 * its filter, so scrolling the card away, a reload of the chat's detail or a second card on the same question starts
 * where the person left it. And what the person sent, shown as the receipt until the chat's own `answered` event comes.
 */

export interface QuestionDraft {
  readonly page: number;
  readonly answers: readonly DraftAnswer[];
  readonly filter: string;
}

const drafts = new Map<string, QuestionDraft>();
const sent = new Map<string, { readonly turnId: string; readonly answers: readonly QuestionAnswer[] }>();

/** What the person sent for a question from this page, until the chat says it. */
export const sentAnswer = (questionId: string) => sent.get(questionId);

/** Records what was sent (the answer's turn hides its prompt; the card shows the receipt). */
export function rememberSent(questionId: string, turnId: string, answers: readonly QuestionAnswer[]): void {
  sent.set(questionId, { turnId, answers });
  drafts.delete(questionId);
}

/** The turns that carried answers sent from this page. */
export const sentTurnIds = (): ReadonlySet<string> =>
  new Set([...sent.values()].map((entry) => entry.turnId));

/** The card's draft of a question with `count` questions, and how to change it. */
export function useQuestionDraft(questionId: string, count: number) {
  const [draft, setDraft] = useState<QuestionDraft>(
    () => drafts.get(questionId) ?? { page: 0, answers: Array(count).fill(EMPTY_DRAFT), filter: '' },
  );
  const update = useCallback(
    (change: (current: QuestionDraft) => QuestionDraft) =>
      setDraft((current) => {
        const next = change(current);
        drafts.set(questionId, next);
        return next;
      }),
    [questionId],
  );
  return { draft, update };
}
