import type { TurnEvent } from '@mwc/shared/harness';
import { TEST_NOW } from '@mwc/testkit';
import type { FakeRunner } from '@mwc/testkit/runner';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ChatDetailView, ChatTurnView } from '../../../../src/modules/chats/schemas.ts';
import { openStream } from '../../../fixtures/chats/stream.ts';
import {
  ANSWER,
  type ChatsWorld,
  chatPath,
  chatRow,
  chatsWorld,
  ended,
  endTurn,
  type Scene,
  scene,
  sendEvents,
  startedTurn,
  turnRow,
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

const refusal = (res: { status: number; body: unknown }) => [
  res.status,
  (res.body as { error?: { code?: string } }).error?.code,
];

const compact = (s: Scene, person?: Person) =>
  as(w, person ?? s.company.owner)('POST', chatPath(s.company, s.chat.id, '/compact'));
const clear = (s: Scene, person?: Person) =>
  as(w, person ?? s.company.owner)('POST', chatPath(s.company, s.chat.id, '/clear'));
const detail = async (s: Scene) =>
  (await as(w, s.company.owner)('GET', chatPath(s.company, s.chat.id))).body as ChatDetailView;

/** A first turn answered, so the chat has its session; the runner sends `extra` events before its end. */
async function answered(s: Scene, extra: Parameters<typeof sendEvents>[2] = []) {
  const start = await startedTurn(w, s);
  const runner = s.runner as FakeRunner;
  sendEvents(runner, start.turnId, [...ANSWER.slice(0, 3), ...extra, ...ANSWER.slice(3)]);
  endTurn(runner, start.turnId);
  await ended(w.t.db, start.turnId);
  return start;
}

const INIT: TurnEvent = { type: 'init', model: 'claude-opus-5-5', slashCommands: ['compact'] };
const CONTEXT: TurnEvent = {
  type: 'context',
  inputTokens: 3,
  cacheReadTokens: 150_000,
  cacheCreationTokens: 2000,
  outputTokens: 40,
  window: 1_000_000,
};

describe('POST chats/:chatId/compact', () => {
  it("runs the harness's /compact as a turn of kind compact on the chat's session", async () => {
    const s = await scene(w);
    await answered(s, [INIT, CONTEXT]);
    const res = await compact(s);
    expect(res.status).toBe(202);
    const turn = res.body as ChatTurnView;
    expect(turn).toMatchObject({ seq: 2, kind: 'compact', prompt: '/compact', status: 'running' });
    const start = await (s.runner as FakeRunner).frames.next('turn.start');
    expect(start.spec).toMatchObject({ prompt: '/compact', sessionId: 'b4c1f0e2-session' });
    sendEvents(s.runner as FakeRunner, start.turnId, [
      { type: 'compact', preTokens: 152_003, postTokens: 18_000, trigger: 'manual' },
      { type: 'usage', inputTokens: 8, outputTokens: 2410 },
      { type: 'result', ok: true, durationMs: 41_000 },
    ]);
    endTurn(s.runner as FakeRunner, start.turnId);
    expect(await ended(w.t.db, start.turnId)).toMatchObject({
      kind: 'compact',
      status: 'done',
      resultText: null,
    });
    const chat = await detail(s);
    expect(chat.turns.map((t) => [t.seq, t.kind])).toEqual([
      [1, 'message'],
      [2, 'compact'],
    ]);
    expect(chat.init).toEqual(INIT);
    expect(chat.context).toEqual({
      usedTokens: 18_000,
      window: 1_000_000,
      model: 'claude-opus-5-5',
      at: expect.any(String),
    });
    expect((await chatRow(w.t.db, s.chat.id))?.title).toBe('What is 2 + 2?');
  });

  it('is for admins and owners, 404s an unknown chat, and refuses a chat without a conversation', async () => {
    const s = await scene(w);
    for (const role of ['member', 'viewer'] as const) {
      expect((await compact(s, await addMember(w, s.company, role))).status).toBe(403);
    }
    const missing = await as(w, s.company.owner)('POST', chatPath(s.company, 'nope', '/compact'));
    expect(refusal(missing)).toEqual([404, 'chat_not_found']);
    expect(refusal(await compact(s))).toEqual([409, 'nothing_to_compact']);
  });

  it('refuses while a turn runs, an archived chat, a Codex chat, and what a turn refuses', async () => {
    const s = await scene(w);
    const start = await startedTurn(w, s);
    expect(refusal(await compact(s))).toEqual([409, 'turn_running']);
    sendEvents(s.runner as FakeRunner, start.turnId, ANSWER);
    endTurn(s.runner as FakeRunner, start.turnId);
    await ended(w.t.db, start.turnId);
    await w.disconnectAll();
    expect(refusal(await compact(s))).toEqual([409, 'machine_offline']);
    await as(w, s.company.owner)('DELETE', chatPath(s.company, s.chat.id));
    expect(refusal(await compact(s))).toEqual([409, 'chat_archived']);
    const codex = await scene(w, { harness: 'codex' });
    await answered(codex);
    expect(refusal(await compact(codex))).toEqual([409, 'compact_unsupported']);
  });
});

describe('POST chats/:chatId/clear', () => {
  it('records a Clear turn, forgets the session, and the next turn starts a new conversation', async () => {
    const s = await scene(w);
    await answered(s, [INIT, CONTEXT]);
    const stream = await openStream(w.t.app, chatPath(s.company, s.chat.id, '/stream'), {
      authorization: `Bearer fake:${s.company.owner.subject}`,
    });
    streams.push(stream);
    w.clock.set('2026-11-09T12:00:00.000Z');
    const res = await clear(s);
    expect(res.status).toBe(200);
    const turn = res.body as ChatTurnView;
    expect(turn).toMatchObject({
      seq: 2,
      kind: 'clear',
      prompt: '/clear',
      status: 'done',
      profileId: null,
      credentialId: null,
      startedAt: '2026-11-09T12:00:00.000Z',
      endedAt: '2026-11-09T12:00:00.000Z',
      createdBy: s.company.owner.principalId,
    });
    expect(await chatRow(w.t.db, s.chat.id)).toMatchObject({ sessionId: null, title: 'What is 2 + 2?' });
    await stream.until('the Clear turn', (messages) =>
      messages.some((m) => m.event === 'turn' && (m.data as { turn: ChatTurnView }).turn.kind === 'clear'),
    );
    const chat = await detail(s);
    expect(chat.turns.map((t) => [t.seq, t.kind, t.events.length])).toEqual([[2, 'clear', 0]]);
    expect(chat.earlier.conversations).toMatchObject([{ clearTurnId: turn.id, clearSeq: 2, turns: 1 }]);
    expect([chat.sessionId, chat.init, chat.context]).toEqual([null, null, null]);
    const next = await startedTurn(w, s, 'Start over');
    expect(next.spec.sessionId).toBeNull();
    expect((await turnRow(w.t.db, next.turnId))?.seq).toBe(3);
  });

  it('is for admins and owners, 404s an unknown chat, and refuses a chat without a conversation', async () => {
    const s = await scene(w, { offline: true });
    for (const role of ['member', 'viewer'] as const) {
      expect((await clear(s, await addMember(w, s.company, role))).status).toBe(403);
    }
    const missing = await as(w, s.company.owner)('POST', chatPath(s.company, 'nope', '/clear'));
    expect(refusal(missing)).toEqual([404, 'chat_not_found']);
    expect(refusal(await clear(s))).toEqual([409, 'nothing_to_clear']);
  });

  it('refuses while a turn runs and on an archived chat; a Codex chat clears too', async () => {
    const s = await scene(w);
    await startedTurn(w, s);
    expect(refusal(await clear(s))).toEqual([409, 'turn_running']);
    const archived = await scene(w);
    await answered(archived);
    await as(w, archived.company.owner)('DELETE', chatPath(archived.company, archived.chat.id));
    expect(refusal(await clear(archived))).toEqual([409, 'chat_archived']);
    const codex = await scene(w, { harness: 'codex' });
    await answered(codex);
    expect(await clear(codex)).toMatchObject({ status: 200, body: { kind: 'clear' } });
  });
});
