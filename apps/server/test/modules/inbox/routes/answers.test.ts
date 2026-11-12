import type { AskQuestion } from '@mwc/shared/harness';
import { newId } from '@mwc/shared/ids';
import type { FakeRunner } from '@mwc/testkit/runner';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { InboxItem } from '../../../../src/modules/inbox/schemas.ts';
import {
  type ChatsWorld,
  chatPath,
  chatsWorld,
  ended,
  endTurn,
  scene,
  sendEvents,
  startedTurn,
} from '../../../fixtures/chats/world.ts';
import { as } from '../../../fixtures/members/members.ts';

/**
 * Answering an agent's question from the Inbox (S6c, docs/processes.md "Inbox answers"): the item carries the questions
 * with their options, the card sends its picks to the chat's answers route as the chat page does, and the item goes; a
 * second answer is refused as closed, which the card shows.
 */

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(() => w.disconnectAll());
afterAll(() => w.close());

const QUESTIONS: AskQuestion[] = [
  {
    question: 'Which database should the service use?',
    header: 'Database',
    options: [
      { label: 'PostgreSQL', description: 'The one the other services use' },
      { label: 'SQLite', description: 'A file beside the service' },
    ],
    multiSelect: false,
  },
  {
    question: 'Which parts come first?',
    header: 'Parts',
    options: [
      { label: 'Auth', description: 'Sign-in' },
      { label: 'Billing', description: 'Plans' },
    ],
    multiSelect: true,
  },
];

describe('answering from the Inbox', () => {
  it('shows the questions with their options, takes the card’s answers, then refuses a second', async () => {
    const s = await scene(w);
    const start = await startedTurn(w, s, 'Set up the service');
    const runner = s.runner as FakeRunner;
    const questionId = newId();
    runner.send({ type: 'turn.question', turnId: start.turnId, seq: 1, questionId, questions: QUESTIONS });
    sendEvents(runner, start.turnId, [{ type: 'result', ok: true, text: 'Two choices first.' }], 2);
    endTurn(runner, start.turnId);
    await ended(w.t.db, start.turnId);

    const owner = as(w, s.company.owner);
    const inbox = await owner('GET', `/api/companies/${s.company.companyId}/inbox`);
    const [item] = (inbox.body as { items: InboxItem[] }).items;
    expect(item?.question).toMatchObject({ questionId, count: 2, questions: QUESTIONS });

    const card = item?.question as NonNullable<InboxItem['question']>;
    const answers = [
      { question: card.questions[0]?.question, picked: ['SQLite'] },
      { question: card.questions[1]?.question, picked: ['Auth'], other: 'and the API' },
    ];
    const sent = await owner('POST', chatPath(s.company, card.chatId, '/answers'), { questionId, answers });
    expect(sent.status).toBe(202);
    const next = await runner.frames.next('turn.start');
    expect(next.spec.prompt).toContain('1. Which database should the service use? → SQLite');
    const after = await owner('GET', `/api/companies/${s.company.companyId}/inbox`);
    expect((after.body as { items: InboxItem[] }).items).toEqual([]);

    endTurn(runner, next.turnId);
    await ended(w.t.db, next.turnId);
    const again = await owner('POST', chatPath(s.company, card.chatId, '/answers'), { questionId, answers });
    expect(again.status).toBe(409);
    expect((again.body as { error: { code: string } }).error.code).toBe('question_closed');
  });
});
