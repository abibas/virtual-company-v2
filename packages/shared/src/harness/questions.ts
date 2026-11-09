import { z } from 'zod';
import { ASK_LIMITS } from '../chats.ts';
import { protocolObject } from '../runner-protocol/common.ts';

export { ASK_LIMITS, ASK_SERVER, ASK_TOOL, ASK_TOOL_CALLS } from '../chats.ts';

/**
 * Selections (S5.2 step 4, docs/harness.md "Asking the person"): an agent asks the person multiple-choice questions
 * through the runner's MCP tool `ask_user_question`, the runner sends them to the server (`turn.question`), the chat
 * shows them as a card, and the person's picks come back as the chat's next prompt. The shapes here are the tool's
 * input, the person's answers, and the two events a turn keeps of them (`question`, `answered`).
 */

const unique = (values: readonly string[]) => new Set(values).size === values.length;

/** One choice: its label (what the answer names) and one line on what it means. */
export const AskOption = protocolObject({
  label: z.string().trim().min(1).max(ASK_LIMITS.label),
  description: z.string().max(ASK_LIMITS.description),
});
export type AskOption = z.infer<typeof AskOption>;

/** One question: its text, a short header (`Database`), its options (labels unique), one pick or several. */
export const AskQuestion = protocolObject({
  question: z.string().trim().min(1).max(ASK_LIMITS.question),
  header: z.string().trim().min(1).max(ASK_LIMITS.header),
  options: z
    .array(AskOption)
    .min(ASK_LIMITS.options.min)
    .max(ASK_LIMITS.options.max)
    .refine((options) => unique(options.map((option) => option.label)), 'each option needs its own label'),
  multiSelect: z.boolean(),
});
export type AskQuestion = z.infer<typeof AskQuestion>;

/** What the tool takes: 1 to 4 questions, each asked once. */
export const AskQuestions = z
  .array(AskQuestion)
  .min(ASK_LIMITS.questions.min)
  .max(ASK_LIMITS.questions.max)
  .refine((questions) => unique(questions.map((q) => q.question)), 'each question is asked once');
export type AskQuestions = z.infer<typeof AskQuestions>;

/** The tool's input: `{ questions }`. */
export const AskInput = protocolObject({ questions: AskQuestions });
export type AskInput = z.infer<typeof AskInput>;

/** The person's answer to one question: the labels picked, and their own words; neither: skipped. */
export const QuestionAnswer = protocolObject({
  question: z.string().min(1).max(ASK_LIMITS.question),
  picked: z.array(z.string().min(1).max(ASK_LIMITS.label)).max(ASK_LIMITS.options.max),
  other: z.string().trim().min(1).max(ASK_LIMITS.other).optional(),
});
export type QuestionAnswer = z.infer<typeof QuestionAnswer>;

/** The answers to a call's questions, at most one for each. */
export const QuestionAnswers = z.array(QuestionAnswer).min(1).max(ASK_LIMITS.questions.max);
export type QuestionAnswers = z.infer<typeof QuestionAnswers>;

/** The agent asked (the runner's relay of a tool call, `turn.question`; a harness's parser never gives it). */
export const QuestionEvent = protocolObject({
  type: z.literal('question'),
  /** The runner's UUID of this call: the answer names it. */
  id: z.uuid(),
  questions: AskQuestions,
});
export type QuestionEvent = z.infer<typeof QuestionEvent>;

/** The person answered it (the server's, in the question's turn): their answers and the turn that carried them. */
export const AnsweredEvent = protocolObject({
  type: z.literal('answered'),
  questionId: z.uuid(),
  /** The chat's next turn, whose prompt is the answers in words. */
  turnId: z.uuid(),
  answers: QuestionAnswers,
});
export type AnsweredEvent = z.infer<typeof AnsweredEvent>;
