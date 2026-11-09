import type {
  AnsweredEvent,
  AskQuestion,
  QuestionAnswer,
  QuestionEvent,
  TurnEvent,
} from '@mwc/shared/harness';
import { refuse } from '../rules.ts';

/**
 * Selections (S5.2 step 4, docs/harness.md "Asking the person"): where an agent's question stands, whether the
 * person's answers fit it, and the prompt that carries them to the agent. A question is a turn's `question` event; the
 * open one is the latest question of the chat's last turn while no `answered` event names it. A newer turn (a plain
 * message, a Clear) or a later question in the same turn supersedes it. Pure.
 */

export const QUESTION_NOT_FOUND = refuse(404, 'question_not_found', 'No such question in this chat');
export const QUESTION_CLOSED = refuse(
  409,
  'question_closed',
  'This question is closed: it was answered, or the chat moved on; answer in a message instead',
);
export const invalidAnswers = (why: string) => refuse(422, 'invalid_answers', why);

/** A turn with its events, as the rules read them. */
export interface QuestionTurn {
  readonly id: string;
  readonly seq: number;
  readonly events: readonly { readonly event: TurnEvent }[];
}

export type QuestionState = 'open' | 'answered' | 'superseded';

/** A question found in the chat, the turn it is in, and where it stands. */
export interface FoundQuestion {
  readonly turn: QuestionTurn;
  readonly event: QuestionEvent;
  readonly state: QuestionState;
}

/** The chat's open question, as its detail shows it. */
export interface OpenQuestion {
  readonly turnId: string;
  readonly id: string;
  readonly questions: AskQuestion[];
}

const questionsOf = (turn: QuestionTurn) =>
  turn.events.flatMap(({ event }) => (event.type === 'question' ? [event] : []));

const answerOf = (turn: QuestionTurn, questionId: string) =>
  turn.events.find(
    (item): item is { event: AnsweredEvent } =>
      item.event.type === 'answered' && item.event.questionId === questionId,
  )?.event;

/** The question with this id and where it stands; undefined when the chat has none of that id. */
export function findQuestion(turns: readonly QuestionTurn[], questionId: string): FoundQuestion | undefined {
  const index = turns.findIndex((turn) => questionsOf(turn).some((event) => event.id === questionId));
  const turn = turns[index];
  if (turn === undefined) return undefined;
  const asked = questionsOf(turn);
  const event = asked.find((question) => question.id === questionId) as QuestionEvent;
  if (answerOf(turn, questionId) !== undefined) return { turn, event, state: 'answered' };
  const latest = index === turns.length - 1 && asked.at(-1) === event;
  return { turn, event, state: latest ? 'open' : 'superseded' };
}

/** The chat's open question (see above), or null. */
export function openQuestion(turns: readonly QuestionTurn[]): OpenQuestion | null {
  const last = turns.at(-1);
  const event = last === undefined ? undefined : questionsOf(last).at(-1);
  if (last === undefined || event === undefined || answerOf(last, event.id) !== undefined) return null;
  return { turnId: last.id, id: event.id, questions: event.questions };
}

/**
 * The check of the transaction that records an answer's turn: its number must come right after the question's turn
 * (no turn came in between since the question was read), else `question_closed`.
 */
export const closedUnlessNext =
  (askedSeq: number) =>
  (seq: number): typeof QUESTION_CLOSED | undefined =>
    seq === askedSeq + 1 ? undefined : QUESTION_CLOSED;

/**
 * Why the answers do not fit the questions, in words; undefined when they fit. Each answer names a question asked (once),
 * picks only its options' labels (each once), and at most one of a single-choice question.
 */
export function answersProblem(
  questions: readonly AskQuestion[],
  answers: readonly QuestionAnswer[],
): string | undefined {
  const seen = new Set<string>();
  for (const answer of answers) {
    const question = questions.find((asked) => asked.question === answer.question);
    if (question === undefined) return `"${answer.question}" is not one of the questions asked`;
    if (seen.has(answer.question)) return `"${answer.question}" is answered twice`;
    seen.add(answer.question);
    const labels = new Set(question.options.map((option) => option.label));
    const unknown = answer.picked.find((label) => !labels.has(label));
    if (unknown !== undefined) return `"${unknown}" is not an option of "${question.question}"`;
    if (new Set(answer.picked).size !== answer.picked.length)
      return `An option of "${question.question}" is picked twice`;
    if (!question.multiSelect && answer.picked.length > 1) return `"${question.question}" takes one pick`;
  }
  return undefined;
}

/** What one answer says: its picks, then the person's own words; neither: skipped. */
function answerText(answer: QuestionAnswer | undefined): string {
  const parts = [...(answer?.picked.length ? [answer.picked.join(', ')] : [])];
  if (answer?.other !== undefined) parts.push(`Other: ${answer.other}`);
  return parts.length === 0 ? 'skipped' : parts.join('; ');
}

/** The prompt that carries the answers: one numbered line per question, in the order asked. */
export function answersPrompt(questions: readonly AskQuestion[], answers: readonly QuestionAnswer[]): string {
  const lines = questions.map((question, index) => {
    const answer = answers.find((given) => given.question === question.question);
    return `${index + 1}. ${question.question} → ${answerText(answer)}`;
  });
  return ['My answers to your questions:', ...lines].join('\n');
}
