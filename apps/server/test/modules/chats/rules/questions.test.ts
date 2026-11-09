import type { AskQuestion, TurnEvent } from '@mwc/shared/harness';
import { describe, expect, it } from 'vitest';
import {
  answersProblem,
  answersPrompt,
  closedUnlessNext,
  findQuestion,
  openQuestion,
  type QuestionTurn,
} from '../../../../src/modules/chats/rules/questions.ts';

const DATABASE: AskQuestion = {
  question: 'Which database?',
  header: 'Database',
  options: [
    { label: 'PostgreSQL', description: 'Shared' },
    { label: 'SQLite', description: 'A file' },
  ],
  multiSelect: false,
};
const PARTS: AskQuestion = {
  question: 'Which parts first?',
  header: 'Parts',
  options: [
    { label: 'Auth', description: '' },
    { label: 'Billing', description: '' },
    { label: 'Admin', description: '' },
  ],
  multiSelect: true,
};

const Q1 = '019a6c1d-0000-7000-8000-000000000001';
const Q2 = '019a6c1d-0000-7000-8000-000000000002';
const T2 = '019a6c1d-0000-7000-8000-0000000000t2';

const asked = (id: string): TurnEvent => ({ type: 'question', id, questions: [DATABASE] });
const turn = (seq: number, events: TurnEvent[]): QuestionTurn => ({
  id: `turn-${seq}`,
  seq,
  events: events.map((event) => ({ event })),
});

describe('where a question stands', () => {
  it('is open while it is the latest of the last turn and not answered', () => {
    const turns = [turn(1, [{ type: 'text', text: 'Hm' }, asked(Q1)])];
    expect(findQuestion(turns, Q1)).toMatchObject({ state: 'open', turn: { seq: 1 }, event: { id: Q1 } });
    expect(openQuestion(turns)).toEqual({ turnId: 'turn-1', id: Q1, questions: [DATABASE] });
    expect(findQuestion(turns, Q2)).toBeUndefined();
  });

  it('is answered once its turn has the answer naming it', () => {
    const answered: TurnEvent = { type: 'answered', questionId: Q1, turnId: T2, answers: [] as never };
    const turns = [turn(1, [asked(Q1), answered])];
    expect(findQuestion(turns, Q1)?.state).toBe('answered');
    expect(openQuestion(turns)).toBeNull();
  });

  it('is superseded by a later question of its turn, or by any newer turn', () => {
    const twice = [turn(1, [asked(Q1), asked(Q2)])];
    expect([findQuestion(twice, Q1)?.state, findQuestion(twice, Q2)?.state]).toEqual(['superseded', 'open']);
    expect(openQuestion(twice)?.id).toBe(Q2);
    const movedOn = [turn(1, [asked(Q1)]), turn(2, [{ type: 'text', text: 'Plain message' }])];
    expect(findQuestion(movedOn, Q1)?.state).toBe('superseded');
    expect(openQuestion(movedOn)).toBeNull();
    expect(openQuestion([])).toBeNull();
  });

  it('is closed for an answer whose turn would not come right after the question’s', () => {
    expect(closedUnlessNext(3)(4)).toBeUndefined();
    expect(closedUnlessNext(3)(5)).toMatchObject({ status: 409, code: 'question_closed' });
  });
});

describe('the answers', () => {
  it('fit when they name questions asked, once, with their own labels, one pick of a single choice', () => {
    const fits = [
      { question: 'Which database?', picked: ['SQLite'] },
      { question: 'Which parts first?', picked: ['Auth', 'Admin'], other: 'And the API' },
    ];
    expect(answersProblem([DATABASE, PARTS], fits)).toBeUndefined();
    expect(answersProblem([DATABASE], [{ question: 'Which database?', picked: [] }])).toBeUndefined();
  });

  it('say what does not fit', () => {
    const cases: [{ question: string; picked: string[] }[], string][] = [
      [[{ question: 'Which colour?', picked: [] }], '"Which colour?" is not one of the questions asked'],
      [
        [
          { question: 'Which database?', picked: [] },
          { question: 'Which database?', picked: ['SQLite'] },
        ],
        '"Which database?" is answered twice',
      ],
      [[{ question: 'Which database?', picked: ['MySQL'] }], '"MySQL" is not an option of "Which database?"'],
      [
        [{ question: 'Which parts first?', picked: ['Auth', 'Auth'] }],
        'An option of "Which parts first?" is picked twice',
      ],
      [
        [{ question: 'Which database?', picked: ['SQLite', 'PostgreSQL'] }],
        '"Which database?" takes one pick',
      ],
    ];
    for (const [answers, why] of cases) expect(answersProblem([DATABASE, PARTS], answers)).toBe(why);
  });

  it('become a prompt of one numbered line per question asked, a question left out said as skipped', () => {
    const third: AskQuestion = { ...DATABASE, question: 'Where does it run?' };
    const prompt = answersPrompt(
      [DATABASE, PARTS, third],
      [
        { question: 'Which parts first?', picked: ['Auth', 'Billing'], other: 'the API too' },
        { question: 'Which database?', picked: ['SQLite'] },
      ],
    );
    expect(prompt).toBe(
      [
        'My answers to your questions:',
        '1. Which database? → SQLite',
        '2. Which parts first? → Auth, Billing; Other: the API too',
        '3. Where does it run? → skipped',
      ].join('\n'),
    );
    expect(answersPrompt([DATABASE], [{ question: 'Which database?', picked: [], other: 'MariaDB' }])).toBe(
      'My answers to your questions:\n1. Which database? → Other: MariaDB',
    );
  });
});
