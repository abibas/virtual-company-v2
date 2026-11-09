import { CircleCheck, MessageSquareText } from 'lucide-react';
import type { AskQuestion, QuestionAnswer } from '../../../../api/types.ts';
import { QuestionForm } from './QuestionForm.tsx';
import { answerWords, type QuestionStatus, type TurnQuestion } from './question-model.ts';
import { sentAnswer } from './use-question-draft.ts';

/**
 * The agent's question under its reply (S5.2 step 4): while open, a card in the "needs your input" colour with the
 * form; once answered, a compact receipt of the picks ("You answered"); when the person wrote a message instead, one
 * quiet line ("Answered in a message").
 */

/** How the person answers from the thread: the call, and why they cannot (not an admin, an archived chat). */
export interface Answering {
  answer(questionId: string, answers: QuestionAnswer[]): Promise<void>;
  readonly closed: string | undefined;
}

function Receipt({
  questions,
  answers,
}: {
  readonly questions: readonly AskQuestion[];
  readonly answers: readonly QuestionAnswer[];
}) {
  return (
    <section
      aria-label="Your answer"
      className="grid w-full max-w-xl gap-2 rounded-xl bg-surface px-3.5 py-3 ring-1 ring-line ring-inset"
    >
      <header className="flex items-center gap-2 text-xs font-semibold text-ink">
        <CircleCheck size={14} aria-hidden="true" className="text-done" />
        You answered
      </header>
      <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        {questions.map((question) => (
          <div key={question.question} className="contents">
            <dt className="truncate text-dim" title={question.question}>
              {question.header}
            </dt>
            <dd className="min-w-0 font-medium break-words whitespace-pre-wrap text-ink">
              {answerWords(answers.find((answer) => answer.question === question.question))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Superseded({ questions }: { readonly questions: readonly AskQuestion[] }) {
  return (
    <p className="flex min-w-0 items-center gap-2 text-xs text-dim">
      <MessageSquareText size={14} aria-hidden="true" className="shrink-0" />
      <span className="min-w-0 truncate">
        {questions.map((question) => question.header).join(', ')}: answered in a message
      </span>
    </p>
  );
}

export function QuestionCard({
  question,
  status,
  running,
  answering,
}: {
  readonly question: TurnQuestion;
  readonly status: QuestionStatus;
  /** The asking turn has not ended yet: the answer waits for it. */
  readonly running: boolean;
  readonly answering: Answering | undefined;
}) {
  const { id, questions } = question.event;
  const sent = sentAnswer(id);
  if (question.answered || sent) {
    return <Receipt questions={questions} answers={question.answered?.answers ?? sent?.answers ?? []} />;
  }
  if (status === 'superseded') return <Superseded questions={questions} />;
  const many = questions.length > 1;
  return (
    <section
      aria-label={many ? `${questions.length} questions from the agent` : 'A question from the agent'}
      className="w-full max-w-xl rounded-xl bg-surface px-3.5 pt-3 pb-3.5 shadow-card ring-1 ring-input/40 ring-inset"
    >
      <QuestionForm
        questionId={id}
        questions={questions}
        disabled={
          answering === undefined
            ? 'You can read this question; admins and owners answer it.'
            : answering.closed
        }
        waiting={running ? 'The agent is finishing its turn; you can answer in a moment.' : undefined}
        onSend={(answers) => (answering ? answering.answer(id, answers) : Promise.resolve())}
      />
    </section>
  );
}
