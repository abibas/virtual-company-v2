import { describe, expect, it } from 'vitest';
import {
  ASK_LIMITS,
  ASK_TOOL_CALLS,
  AskInput,
  AskQuestion,
  AskQuestions,
  QuestionAnswer,
  QuestionAnswers,
} from '../../src/harness/questions.ts';
import { QUESTION } from '../fixtures/runner-protocol/frames.ts';
import { issuesOf } from '../fixtures/runner-protocol/issues.ts';

const option = (label: string) => ({ label, description: `About ${label}` });
const numbered = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ ...QUESTION, question: `Question ${i}?` }));

describe('the ask_user_question input', () => {
  it('takes 1 to 4 questions of 2 to 8 options, one pick or several', () => {
    expect(issuesOf(AskInput, { questions: [QUESTION] })).toEqual([]);
    const many = { ...QUESTION, multiSelect: true, options: 'ABCDEFGH'.split('').map(option) };
    expect(issuesOf(AskQuestion, many)).toEqual([]);
    expect(issuesOf(AskQuestions, numbered(4))).toEqual([]);
    expect(ASK_TOOL_CALLS).toEqual(['mcp__mwc__ask_user_question', 'mcp:mwc/ask_user_question']);
  });

  it('refuses a call outside its limits', () => {
    const longDescription = { label: 'A', description: 'x'.repeat(ASK_LIMITS.description + 1) };
    const cases: [unknown, string][] = [
      [{ ...QUESTION, question: '' }, 'question'],
      [{ ...QUESTION, question: 'x'.repeat(ASK_LIMITS.question + 1) }, 'question'],
      [{ ...QUESTION, header: 'A header too long' }, 'header'],
      [{ ...QUESTION, header: '  ' }, 'header'],
      [{ ...QUESTION, options: [option('One')] }, 'options'],
      [{ ...QUESTION, options: 'ABCDEFGHI'.split('').map(option) }, 'options'],
      [{ ...QUESTION, options: [option('Same'), option('Same')] }, 'options'],
      [{ ...QUESTION, options: [option('x'.repeat(ASK_LIMITS.label + 1)), option('B')] }, 'options.0.label'],
      [{ ...QUESTION, options: [longDescription, option('B')] }, 'options.0.description'],
      [{ ...QUESTION, multiSelect: 'yes' }, 'multiSelect'],
    ];
    for (const [question, path] of cases) expect(issuesOf(AskQuestion, question)).toEqual([path]);
    expect(issuesOf(AskQuestions, [])).toEqual(['']);
    expect(issuesOf(AskQuestions, [QUESTION, QUESTION])).toEqual(['']);
    expect(issuesOf(AskQuestions, numbered(5))).toEqual(['']);
    expect(issuesOf(AskInput, {})).toEqual(['questions']);
  });
});

describe("the person's answers", () => {
  it('pick labels, add their own words, or skip; at most one per question', () => {
    expect(issuesOf(QuestionAnswer, { question: 'Q?', picked: ['A', 'B'], other: 'Mine' })).toEqual([]);
    expect(issuesOf(QuestionAnswer, { question: 'Q?', picked: [] })).toEqual([]);
    expect(QuestionAnswer.parse({ question: 'Q?', picked: [], other: '  Mine ' }).other).toBe('Mine');
    expect(issuesOf(QuestionAnswer, { question: 'Q?', picked: [], other: ' ' })).toEqual(['other']);
    expect(issuesOf(QuestionAnswer, { question: 'Q?', picked: [''] })).toEqual(['picked.0']);
    expect(issuesOf(QuestionAnswer, { question: '', picked: [] })).toEqual(['question']);
    expect(issuesOf(QuestionAnswers, [])).toEqual(['']);
    const five = Array.from({ length: 5 }, () => ({ question: 'Q?', picked: [] }));
    expect(issuesOf(QuestionAnswers, five)).toEqual(['']);
  });
});
