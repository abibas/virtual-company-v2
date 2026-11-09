import type { AskQuestion, QuestionAnswer } from '../../../../api/types.ts';

/**
 * The question card's draft (S5.2 step 4): per question, the labels picked and the person's own words in the "Other"
 * box; a click's effect, whether a question is answered, and the answers the card sends. Pure.
 */

/** The card's draft of one question: the labels picked, and the "Other" box. */
export interface DraftAnswer {
  readonly picked: readonly string[];
  readonly other: string;
}

export const EMPTY_DRAFT: DraftAnswer = { picked: [], other: '' };

/** The draft after a click on `label`: one pick replaces another, several toggle. */
export function toggled(draft: DraftAnswer, label: string, multiSelect: boolean): DraftAnswer {
  const on = draft.picked.includes(label);
  if (!multiSelect) return { ...draft, picked: on ? [] : [label] };
  return {
    ...draft,
    picked: on ? draft.picked.filter((picked) => picked !== label) : [...draft.picked, label],
  };
}

/** True when a question has a pick or words of the person's own. */
export const isAnswered = (draft: DraftAnswer | undefined): boolean =>
  draft !== undefined && (draft.picked.length > 0 || draft.other.trim() !== '');

/** The answers the card sends: one per question with a pick or words (the rest are skipped), picks in option order. */
export function answersOf(
  questions: readonly AskQuestion[],
  drafts: readonly (DraftAnswer | undefined)[],
): QuestionAnswer[] {
  return questions.flatMap((question, index) => {
    const draft = drafts[index];
    if (draft === undefined || !isAnswered(draft)) return [];
    const picked = question.options
      .map((option) => option.label)
      .filter((label) => draft.picked.includes(label));
    const other = draft.other.trim();
    return [{ question: question.question, picked, ...(other ? { other } : {}) }];
  });
}
