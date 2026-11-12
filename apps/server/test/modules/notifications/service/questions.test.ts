import { agents } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { AskQuestion } from '@mwc/shared/harness';
import { newId } from '@mwc/shared/ids';
import type { FakeRunner } from '@mwc/testkit/runner';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  type ChatsWorld,
  chatsWorld,
  eventually,
  type Scene,
  scene,
  sendEvents,
  startedTurn,
} from '../../../fixtures/chats/world.ts';
import { as } from '../../../fixtures/members/members.ts';
import { placedMember } from '../../../fixtures/org.ts';
import type { Person } from '../../../fixtures/platform/auth.ts';
import { noticesOf } from '../../../fixtures/wakes.ts';

/**
 * An agent asks a question (S6c, docs/notifications.md): the people who may answer it, the company's active admins and
 * owners, hear of it (`agent_question`), quoting its first question and pointing at the chat; never the agent, nobody
 * below admin, nobody of another company; a question the runner sends again is told once.
 */

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(() => w.disconnectAll());
afterAll(() => w.close());

const QUESTION: AskQuestion = {
  question: 'Which database should the service use?',
  header: 'Database',
  options: [
    { label: 'PostgreSQL', description: 'The one the other services use' },
    { label: 'SQLite', description: 'A file beside the service' },
  ],
  multiSelect: false,
};

/** The scene's agent asks during a turn; the frame is sent `times` times. */
async function ask(s: Scene, times = 1) {
  const start = await startedTurn(w, s, 'Set up the service');
  const runner = s.runner as FakeRunner;
  sendEvents(runner, start.turnId, [{ type: 'text', text: 'One choice first.' }]);
  const questionId = newId();
  for (let i = 0; i < times; i++)
    runner.send({ type: 'turn.question', turnId: start.turnId, seq: 2, questionId, questions: [QUESTION] });
  return { turnId: start.turnId, questionId };
}

/** The principal of the agent with this id. */
const agentPrincipalOf = async (agentId: string) =>
  ((await rawDb(w.t.db).select().from(agents).where(eq(agents.id, agentId)))[0] as { principalId: string })
    .principalId;

const notices = (person: Pick<Person, 'principalId'> | string) =>
  noticesOf(w.t.db, typeof person === 'string' ? person : person.principalId, 'agent_question');

describe('agent_question', () => {
  it('tells the admins and owners, never the agent nor anyone below admin, and once', async () => {
    const s = await scene(w);
    const admin = await placedMember(w, s.company, 'admin');
    const member = await placedMember(w, s.company, 'member');
    const viewer = await placedMember(w, s.company, 'viewer');
    const elsewhere = await scene(w);
    const agent = await agentPrincipalOf(s.agentId);
    await ask(s, 2);
    await eventually('the admins are told', async () => (await notices(admin)).length > 0);
    const [toOwner, ...more] = await notices(s.company.owner);
    expect(more).toEqual([]);
    expect(toOwner).toMatchObject({
      actorPrincipalId: null,
      payload: { about: agent, agent: s.agentId, chat: s.chat.id, detail: QUESTION.question },
    });
    expect(await notices(admin)).toHaveLength(1);
    expect(await notices(member)).toEqual([]);
    expect(await notices(viewer)).toEqual([]);
    expect(await notices(agent)).toEqual([]);
    expect(await notices(elsewhere.company.owner)).toEqual([]);

    const list = await as(w, admin)('GET', `/api/companies/${s.company.companyId}/notifications`);
    expect(list.body).toMatchObject({
      notifications: [
        {
          kind: 'agent_question',
          text: expect.stringMatching(/ asks: “Which database should the service use\?”$/),
          actor: null,
          path: `chats/${s.agentId}?chat=${s.chat.id}`,
        },
      ],
    });
  });

  it('quotes a long question clipped', async () => {
    const s = await scene(w);
    const start = await startedTurn(w, s, 'Go');
    const long = { ...QUESTION, question: `Which one? ${'x'.repeat(480)}` };
    (s.runner as FakeRunner).send({
      type: 'turn.question',
      turnId: start.turnId,
      seq: 1,
      questionId: newId(),
      questions: [long],
    });
    await eventually('the owner is told', async () => (await notices(s.company.owner)).length > 0);
    const [notice] = await notices(s.company.owner);
    const { detail } = (notice?.payload ?? {}) as { detail: string };
    expect(detail).toHaveLength(200);
    expect(detail.endsWith('…')).toBe(true);
  });
});
