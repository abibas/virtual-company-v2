import { Check, ChevronLeft, ChevronRight, CircleHelp } from 'lucide-react';
import type { AskQuestion } from '../../../../api/types.ts';
import { cx } from '../../../../components/cx.ts';
import { IconButton } from '../../../../components/ui/IconButton.tsx';
import { type DraftAnswer, isAnswered } from './draft.ts';

/**
 * The question card's way around (S5.2 step 4): its header with each question's header as a step (the current one
 * marked, an answered one checked, a click goes there), and the question's own line with "1 of 3" and the arrows.
 */

export function QuestionSteps({
  questions,
  drafts,
  page,
  onStep,
}: {
  readonly questions: readonly AskQuestion[];
  readonly drafts: readonly (DraftAnswer | undefined)[];
  readonly page: number;
  readonly onStep: (page: number) => void;
}) {
  const many = questions.length > 1;
  return (
    <header className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
      <CircleHelp size={15} aria-hidden="true" className="shrink-0 text-input" />
      <h4 className="mr-auto font-semibold text-ink">{many ? 'Questions for you' : 'A question for you'}</h4>
      <ol className="flex min-w-0 flex-wrap gap-1">
        {questions.map((question, index) => {
          const current = index === page;
          const done = isAnswered(drafts[index]);
          return (
            <li key={question.question}>
              <button
                type="button"
                disabled={!many}
                aria-current={current ? 'step' : undefined}
                aria-label={`${question.header}${done ? ', answered' : ''}`}
                onClick={() => onStep(index)}
                className={cx(
                  'inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-2xs font-semibold whitespace-nowrap transition-colors enabled:cursor-pointer disabled:cursor-default',
                  current
                    ? 'bg-input-soft text-ink ring-1 ring-input/50 ring-inset'
                    : 'text-dim enabled:hover:bg-surface-3',
                )}
              >
                {done && <Check size={11} strokeWidth={3} aria-hidden="true" className="text-done" />}
                {question.header}
              </button>
            </li>
          );
        })}
      </ol>
    </header>
  );
}

/** The question itself, with the pager when there are several; the page change is announced. */
export function QuestionHead({
  question,
  page,
  count,
  onStep,
}: {
  readonly question: AskQuestion;
  readonly page: number;
  readonly count: number;
  readonly onStep: (page: number) => void;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <p className="min-w-0 flex-1 text-sm leading-snug font-semibold break-words text-ink">
        {question.question}
      </p>
      {count > 1 && (
        <div className="-mt-1 -mr-1.5 flex shrink-0 items-center gap-0.5">
          <IconButton
            icon={ChevronLeft}
            label="Previous question"
            size="sm"
            disabled={page === 0}
            onClick={() => onStep(page - 1)}
          />
          <span className="min-w-10 text-center text-2xs font-semibold text-dim tabular">
            {page + 1} of {count}
          </span>
          <IconButton
            icon={ChevronRight}
            label="Next question"
            size="sm"
            disabled={page === count - 1}
            onClick={() => onStep(page + 1)}
          />
        </div>
      )}
      <p aria-live="polite" className="sr-only">
        {`Question ${page + 1} of ${count}: ${question.header}. ${question.multiSelect ? 'Pick any.' : 'Pick one.'}`}
      </p>
    </div>
  );
}
