import { tenant } from '@mwc/db';
import { newId } from '@mwc/shared/ids';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { noticeQuestion } from '../../../../src/modules/chats/service/ask-notice.ts';
import { type ChatsWorld, chatsWorld, scene } from '../../../fixtures/chats/world.ts';
import { noticesOf } from '../../../fixtures/wakes.ts';

/**
 * `noticeQuestion` (S6c) tells nobody when there is nothing to tell: a chat that is not the company's, or a question
 * frame without a question. The people told for a real question are in `notifications/service/questions.test.ts`.
 */

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(() => w.disconnectAll());
afterAll(() => w.close());

const QUESTION = {
  question: 'Which database?',
  header: 'Database',
  options: [
    { label: 'PostgreSQL', description: 'Shared' },
    { label: 'SQLite', description: 'A file' },
  ],
  multiSelect: false,
};

describe('noticeQuestion', () => {
  it('tells nobody of a chat it does not find, nor of a frame without a question', async () => {
    const s = await scene(w);
    const t = await tenant(w.t.db, s.company.companyId);
    await noticeQuestion(t, newId(), [QUESTION]);
    await noticeQuestion(t, s.chat.id, []);
    expect(await noticesOf(w.t.db, s.company.owner.principalId, 'agent_question')).toEqual([]);
  });
});
