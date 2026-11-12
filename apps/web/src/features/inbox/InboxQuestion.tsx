import type { InboxItem } from '../../api/inbox.ts';
import type { QuestionAnswer } from '../../api/types.ts';
import { QuestionForm } from '../chats/thread/question/QuestionForm.tsx';

/** How the inbox answers an agent's question: the chat's answers route, in the item's own company. */
export type InboxAnswer = (item: InboxItem, answers: QuestionAnswer[]) => Promise<void>;

/**
 * An agent's question answered in place on its Inbox card (S6c, docs/processes.md "Inbox answers"): the chat card's own
 * form, compact (one question a page with "1 of N" and the arrows, its options as a single or multiple choice, an
 * "Other" box, Send), sent to `POST …/chats/{chatId}/answers`; a refusal (`question_closed`) shows its words under it.
 */
export function InboxQuestion({
  item,
  onAnswer,
}: {
  readonly item: InboxItem;
  readonly onAnswer: InboxAnswer;
}) {
  const question = item.question;
  if (question === null || question.questions.length === 0) return null;
  return (
    <div className="mt-0.5 border-t border-line pt-2">
      <QuestionForm
        compact
        questionId={question.questionId}
        questions={question.questions}
        disabled={undefined}
        waiting={undefined}
        onSend={(answers) => onAnswer(item, answers)}
      />
    </div>
  );
}
