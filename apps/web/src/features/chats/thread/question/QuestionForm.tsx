import { ASK_LIMITS } from '@mwc/shared/chats';
import type { KeyboardEvent } from 'react';
import type { AskQuestion, QuestionAnswer } from '../../../../api/types.ts';
import { useAction } from '../../use-action.ts';
import { answersOf, type DraftAnswer, EMPTY_DRAFT, isAnswered, toggled } from './draft.ts';
import { QuestionActions } from './QuestionActions.tsx';
import { QuestionOptions, visibleOptions } from './QuestionOptions.tsx';
import { QuestionHead, QuestionSteps } from './QuestionSteps.tsx';
import { useQuestionDraft } from './use-question-draft.ts';

/**
 * The open question's form (S5.2 step 4): the headers as steps, one question per page ("1 of 3", arrows), its choices,
 * an "Other" box for the person's own answer, Skip and Next, and "Send answer" on the last page. Number keys pick
 * (outside the text boxes), Left and Right turn the pages. The draft stays while the page lives.
 */

const isTyping = (target: EventTarget) =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

interface FormProps {
  readonly questionId: string;
  readonly questions: readonly AskQuestion[];
  /** Why the person cannot answer here (not an admin, an archived chat); the form is read-only then. */
  readonly disabled: string | undefined;
  /** Why it cannot be sent yet (the agent is still finishing its turn). */
  readonly waiting: string | undefined;
  readonly onSend: (answers: QuestionAnswer[]) => Promise<void>;
  /** Leaves out the headers' steps (the Inbox's card, S6c): "1 of N" and the arrows still turn the pages. */
  readonly compact?: boolean;
}

/** The form's state from its draft, and what each control does. */
function useQuestionForm({ questionId, questions, disabled, onSend }: FormProps) {
  const { draft, update } = useQuestionDraft(questionId, questions.length);
  const action = useAction();
  const count = questions.length;
  const page = Math.min(draft.page, count - 1);
  const question = questions[page] as AskQuestion;
  const answer: DraftAnswer = draft.answers[page] ?? EMPTY_DRAFT;
  const answers = answersOf(questions, draft.answers);
  const readOnly = disabled !== undefined || action.busy;
  const shown = visibleOptions(question, draft.filter);
  const setAnswer = (next: DraftAnswer) =>
    update((d) => ({
      ...d,
      answers: questions.map((_, i) => (i === page ? next : (d.answers[i] ?? EMPTY_DRAFT))),
    }));
  const goTo = (next: number) =>
    update((d) => ({ ...d, page: Math.max(0, Math.min(count - 1, next)), filter: '' }));
  const pick = (label: string) => setAnswer(toggled(answer, label, question.multiSelect));
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (readOnly || isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    const option = /^[1-9]$/.test(event.key) ? shown[Number(event.key) - 1] : undefined;
    const turn = ({ ArrowLeft: -1, ArrowRight: 1 } as Record<string, number>)[event.key];
    if (option === undefined && turn === undefined) return;
    event.preventDefault();
    if (option) pick(option.label);
    else goTo(page + (turn as number));
  };
  return {
    draft,
    page,
    count,
    question,
    answer,
    readOnly,
    action,
    keys: Math.min(9, shown.length),
    setAnswer,
    goTo,
    pick,
    onKeyDown,
    setFilter: (filter: string) => update((d) => ({ ...d, filter })),
    send: () => void action.run(() => onSend(answers)),
    ready: answers.length > 0,
  };
}

export function QuestionForm(props: FormProps) {
  const f = useQuestionForm(props);
  const { question, answer, page } = f;
  const state = {
    multiSelect: question.multiSelect,
    keys: f.keys,
    last: page === f.count - 1,
    answered: isAnswered(answer),
    ready: f.ready,
    busy: f.action.busy,
    disabled: props.disabled,
    waiting: props.waiting,
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the keys only add shortcuts to the buttons inside.
    <div className="grid gap-3" onKeyDown={f.onKeyDown}>
      {!props.compact && (
        <QuestionSteps questions={props.questions} drafts={f.draft.answers} page={page} onStep={f.goTo} />
      )}
      <QuestionHead question={question} page={page} count={f.count} onStep={f.goTo} />
      <QuestionOptions
        question={question}
        picked={answer.picked}
        filter={f.draft.filter}
        disabled={f.readOnly}
        onPick={f.pick}
        onFilter={f.setFilter}
      />
      <textarea
        aria-label={`Other answer to: ${question.question}`}
        value={answer.other}
        onChange={(event) => f.setAnswer({ ...answer, other: event.target.value })}
        maxLength={ASK_LIMITS.other}
        rows={1}
        disabled={f.readOnly}
        placeholder="Other: write your own answer"
        className="field-sizing-content max-h-32 min-h-10 w-full resize-none rounded-md bg-surface-2 px-3 py-2.5 text-sm text-ink ring-1 ring-transparent ring-inset transition-[box-shadow,background-color] placeholder:text-faint focus:bg-surface focus:ring-blue focus:outline-none disabled:opacity-60"
      />
      {f.action.error && (
        <p role="alert" className="text-sm font-medium text-failed">
          {f.action.error}
        </p>
      )}
      <QuestionActions
        state={state}
        onSkip={() => {
          f.setAnswer(EMPTY_DRAFT);
          f.goTo(page + 1);
        }}
        onNext={() => f.goTo(page + 1)}
        onSend={f.send}
      />
    </div>
  );
}
