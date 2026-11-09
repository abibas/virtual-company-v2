import type { AskQuestion } from '@mwc/shared/harness';
import { newId } from '@mwc/shared/ids';
import { TEST_NOW } from '@mwc/testkit';
import type { FakeRunner } from '@mwc/testkit/runner';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ChatDetailView, ChatStreamEvent, ChatTurnView } from '../../../../src/modules/chats/schemas.ts';
import { openStream } from '../../../fixtures/chats/stream.ts';
import {
  type ChatsWorld,
  chatPath,
  chatsWorld,
  ended,
  endTurn,
  eventually,
  type Scene,
  scene,
  sendEvents,
  sendPrompt,
  startedTurn,
} from '../../../fixtures/chats/world.ts';
import { addMember, as } from '../../../fixtures/members/members.ts';
import type { Person } from '../../../fixtures/platform/auth.ts';

let w: ChatsWorld;
const streams: { close(): Promise<void> }[] = [];
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  for (const stream of streams.splice(0)) await stream.close();
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

const DATABASE: AskQuestion = {
  question: 'Which database should the service use?',
  header: 'Database',
  options: [
    { label: 'PostgreSQL', description: 'The one the other services use' },
    { label: 'SQLite', description: 'A file beside the service' },
  ],
  multiSelect: false,
};
const PARTS: AskQuestion = {
  question: 'Which parts come first?',
  header: 'Parts',
  options: [
    { label: 'Auth', description: 'Sign-in' },
    { label: 'Billing', description: 'Plans' },
  ],
  multiSelect: true,
};

const refusal = (res: { status: number; body: unknown }) => [
  res.status,
  (res.body as { error?: { code?: string } }).error?.code,
];

const answer = (s: Scene, body: unknown, person?: Person) =>
  as(w, person ?? s.company.owner)('POST', chatPath(s.company, s.chat.id, '/answers'), body);
const detail = async (s: Scene) =>
  (await as(w, s.company.owner)('GET', chatPath(s.company, s.chat.id))).body as ChatDetailView;

/** A turn that asks `questions` between its text and its result; it ends unless `running`. */
async function asking(s: Scene, questions: AskQuestion[] = [DATABASE, PARTS], running = false) {
  const start = await startedTurn(w, s, 'Set up the service');
  const runner = s.runner as FakeRunner;
  sendEvents(runner, start.turnId, [
    { type: 'session', sessionId: 'b4c1f0e2-session' },
    { type: 'text', text: 'Two choices first.' },
  ]);
  const questionId = newId();
  runner.send({ type: 'turn.question', turnId: start.turnId, seq: 3, questionId, questions });
  if (running) {
    await eventually('the question stored', async () => (await detail(s)).question !== null);
    return { turnId: start.turnId, questionId };
  }
  sendEvents(runner, start.turnId, [{ type: 'result', ok: true, text: 'Two choices first.' }], 4);
  endTurn(runner, start.turnId);
  await ended(w.t.db, start.turnId);
  return { turnId: start.turnId, questionId };
}

const ANSWERS = [
  { question: DATABASE.question, picked: ['SQLite'] },
  { question: PARTS.question, picked: ['Auth', 'Billing'], other: 'and the API' },
];

describe("an agent's question", () => {
  it("is kept as its turn's event between the others, streamed, and the chat's detail shows it open", async () => {
    const s = await scene(w);
    const stream = await openStream(w.t.app, chatPath(s.company, s.chat.id, '/stream'), {
      authorization: `Bearer fake:${s.company.owner.subject}`,
    });
    streams.push(stream);
    const { turnId, questionId } = await asking(s);
    await stream.until('the question', (messages) =>
      messages.some((m) => m.event === 'event' && (m.data as ChatStreamEvent).event.type === 'question'),
    );
    const streamed = stream.messages.find(
      (m) => m.event === 'event' && (m.data as ChatStreamEvent).event.type === 'question',
    );
    expect(streamed?.id).toBe('1.3');
    const chat = await detail(s);
    expect(chat.question).toEqual({ turnId, id: questionId, questions: [DATABASE, PARTS] });
    expect(chat.turns[0]?.events.map((e) => [e.seq, e.event.type])).toEqual([
      [1, 'session'],
      [2, 'text'],
      [3, 'question'],
      [4, 'result'],
    ]);
  });
});

describe('POST chats/:chatId/answers', () => {
  it('starts the next turn with the answers in words and marks the question answered, streamed first', async () => {
    const s = await scene(w);
    const { turnId, questionId } = await asking(s);
    const stream = await openStream(w.t.app, chatPath(s.company, s.chat.id, '/stream'), {
      authorization: `Bearer fake:${s.company.owner.subject}`,
      'last-event-id': '1.4',
    });
    streams.push(stream);
    const res = await answer(s, { questionId, answers: ANSWERS });
    expect(res.status).toBe(202);
    const prompt = [
      'My answers to your questions:',
      '1. Which database should the service use? → SQLite',
      '2. Which parts come first? → Auth, Billing; Other: and the API',
    ].join('\n');
    const next = res.body as ChatTurnView;
    expect(next).toMatchObject({ seq: 2, kind: 'message', prompt, status: 'running' });
    const start = await (s.runner as FakeRunner).frames.next('turn.start');
    expect(start).toMatchObject({ turnId: next.id, spec: { prompt, sessionId: 'b4c1f0e2-session' } });
    const chat = await detail(s);
    expect(chat.question).toBeNull();
    expect(chat.turns[0]?.events.at(-1)).toMatchObject({
      seq: 5,
      event: { type: 'answered', questionId, turnId: next.id, answers: ANSWERS },
    });
    expect(chat.turns[0]?.id).toBe(turnId);
    await stream.until('the answer and the next turn', (messages) =>
      messages.some((m) => m.event === 'turn' && (m.data as { turn: ChatTurnView }).turn.id === next.id),
    );
    const order = stream.messages.flatMap((m) =>
      m.event === 'event'
        ? [`event ${m.id}`]
        : m.event === 'turn'
          ? [`turn ${(m.data as { turn: ChatTurnView }).turn.seq}`]
          : [],
    );
    expect(order.indexOf('event 1.5')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('event 1.5')).toBeLessThan(order.lastIndexOf('turn 2'));
  });

  it('says a question left out is skipped, and takes the person’s own words alone', async () => {
    const s = await scene(w);
    const { questionId } = await asking(s);
    const res = await answer(s, {
      questionId,
      answers: [{ question: PARTS.question, picked: [], other: 'None yet' }],
    });
    expect((res.body as ChatTurnView).prompt).toBe(
      'My answers to your questions:\n1. Which database should the service use? → skipped\n' +
        '2. Which parts come first? → Other: None yet',
    );
  });

  it('refuses a question answered already, and one a plain message closed', async () => {
    const s = await scene(w);
    const { questionId } = await asking(s);
    expect((await answer(s, { questionId, answers: ANSWERS })).status).toBe(202);
    expect(refusal(await answer(s, { questionId, answers: ANSWERS }))).toEqual([409, 'question_closed']);
    const plain = await scene(w);
    const asked = await asking(plain);
    expect((await sendPrompt(w, plain, 'Use whatever you think is best')).status).toBe(202);
    expect((await detail(plain)).question).toBeNull();
    expect(refusal(await answer(plain, { questionId: asked.questionId, answers: ANSWERS }))).toEqual([
      409,
      'question_closed',
    ]);
  });

  it('waits for the asking turn to end, as any turn does', async () => {
    const s = await scene(w);
    const { questionId } = await asking(s, [DATABASE], true);
    expect((await detail(s)).question?.id).toBe(questionId);
    expect(refusal(await answer(s, { questionId, answers: [ANSWERS[0]] }))).toEqual([409, 'turn_running']);
  });

  it('refuses answers that do not fit, an unknown question or chat, a bad body, and anyone below admin', async () => {
    const s = await scene(w);
    const { questionId } = await asking(s);
    const unfit = await answer(s, {
      questionId,
      answers: [{ question: DATABASE.question, picked: ['MySQL'] }],
    });
    expect(refusal(unfit)).toEqual([422, 'invalid_answers']);
    expect((unfit.body as { error: { message: string } }).error.message).toBe(
      '"MySQL" is not an option of "Which database should the service use?"',
    );
    expect(refusal(await answer(s, { questionId: newId(), answers: ANSWERS }))).toEqual([
      404,
      'question_not_found',
    ]);
    const missing = await as(w, s.company.owner)('POST', chatPath(s.company, 'nope', '/answers'), {
      questionId,
      answers: ANSWERS,
    });
    expect(refusal(missing)).toEqual([404, 'chat_not_found']);
    expect(refusal(await answer(s, { questionId, answers: [] }))).toEqual([400, 'invalid_request']);
    for (const role of ['member', 'viewer'] as const) {
      expect(
        (await answer(s, { questionId, answers: ANSWERS }, await addMember(w, s.company, role))).status,
      ).toBe(403);
    }
    expect((await detail(s)).question?.id).toBe(questionId);
  });
});
