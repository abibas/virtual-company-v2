import { CHAT_QUEUE_MAX } from '@mwc/shared/chats';
import { TEST_NOW } from '@mwc/testkit';
import type { FakeRunner } from '@mwc/testkit/runner';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ChatTurnView } from '../../../../../src/modules/chats/schemas.ts';
import { detailOf, queued, runningTurn, sendWith } from '../../../../fixtures/chats/queue.ts';
import {
  type ChatsWorld,
  chatPath,
  chatsWorld,
  ended,
  endTurn,
  eventRows,
  eventually,
  scene,
  sendEvents,
  sendPrompt,
  turnRow,
} from '../../../../fixtures/chats/world.ts';
import { addMember, as } from '../../../../fixtures/members/members.ts';

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

const refusal = (res: { status: number; body: unknown }) => [
  res.status,
  (res.body as { error?: { code?: string } }).error?.code,
];

describe('POST chats/:chatId/turns with a delivery: after this turn', () => {
  it('queues the message, lists it in the detail, and starts it on the session when the running turn ends', async () => {
    const s = await scene(w);
    const first = await runningTurn(w, s);
    const waiting = await queued(w, s, 'And 3 + 3?');
    expect(waiting).toMatchObject({
      seq: 2,
      status: 'queued',
      delivery: 'after',
      startedAt: null,
      credentialId: null,
    });
    expect((await detailOf(w, s)).queue).toEqual([waiting.id]);
    endTurn(s.runner as FakeRunner, first.turnId);
    await ended(w.t.db, first.turnId);
    const next = await (s.runner as FakeRunner).frames.next('turn.start');
    expect(next).toMatchObject({
      turnId: waiting.id,
      spec: { prompt: 'And 3 + 3?', sessionId: 'b4c1f0e2-session' },
    });
    expect(await turnRow(w.t.db, waiting.id)).toMatchObject({
      status: 'running',
      seq: 2,
      profileId: s.profile.id,
      credentialId: s.credential?.id,
      startedAt: new Date(TEST_NOW),
    });
    expect((await detailOf(w, s)).queue).toEqual([]);
  });

  it('keeps refusing a prompt without a delivery while a turn runs, and starts one at once when nothing runs', async () => {
    const s = await scene(w);
    const first = await runningTurn(w, s);
    expect(refusal(await sendPrompt(w, s, 'again'))).toEqual([409, 'turn_running']);
    endTurn(s.runner as FakeRunner, first.turnId);
    await ended(w.t.db, first.turnId);
    const res = await sendWith(w, s, 'now it runs', 'after');
    expect([res.status, (res.body as ChatTurnView).status, (res.body as ChatTurnView).delivery]).toEqual([
      202,
      'running',
      null,
    ]);
  });

  it(`keeps ${CHAT_QUEUE_MAX} messages at most, and is for admins and owners`, async () => {
    const s = await scene(w);
    await runningTurn(w, s);
    for (let n = 0; n < CHAT_QUEUE_MAX; n++) await queued(w, s, `message ${n}`);
    expect(refusal(await sendWith(w, s, 'one more', 'after'))).toEqual([409, 'queue_full']);
    expect((await detailOf(w, s)).queue).toHaveLength(CHAT_QUEUE_MAX);
    const member = await addMember(w, s.company, 'member');
    expect((await sendWith(w, s, 'hi', 'after', member)).status).toBe(403);
    const bad = await as(w, s.company.owner)('POST', chatPath(s.company, s.chat.id, '/turns'), {
      prompt: 'x',
      delivery: 'later',
    });
    expect(refusal(bad)).toEqual([400, 'invalid_request']);
  });

  it('starts the next one after a failure and after a stop too, oldest first', async () => {
    const s = await scene(w);
    const runner = s.runner as FakeRunner;
    const first = await runningTurn(w, s);
    const second = await queued(w, s, 'second');
    const third = await queued(w, s, 'third');
    endTurn(runner, first.turnId, { ok: false, exitCode: 1, error: 'home_missing' });
    expect((await runner.frames.next('turn.start')).turnId).toBe(second.id);
    const stop = await as(w, s.company.owner)(
      'POST',
      chatPath(s.company, s.chat.id, `/turns/${second.id}/stop`),
    );
    expect(stop.status).toBe(202);
    await runner.frames.next('turn.stop');
    endTurn(runner, second.id, { ok: false, exitCode: null, error: 'stopped' });
    expect((await runner.frames.next('turn.start')).turnId).toBe(third.id);
    expect(await turnRow(w.t.db, second.id)).toMatchObject({ status: 'stopped' });
  });

  it('fails the waiting messages with the refusal in words when the machine went away with the turn', async () => {
    const s = await scene(w);
    await runningTurn(w, s);
    const waiting = await queued(w, s, 'later');
    await (s.runner as FakeRunner).disconnect();
    expect(await ended(w.t.db, waiting.id)).toMatchObject({
      status: 'failed',
      error: "The agent's machine has no connected runner",
    });
  });

  it('fails a waiting message of a chat archived meanwhile', async () => {
    const s = await scene(w);
    const first = await runningTurn(w, s);
    const waiting = await queued(w, s, 'later');
    expect((await as(w, s.company.owner)('DELETE', chatPath(s.company, s.chat.id))).status).toBe(204);
    expect(refusal(await sendWith(w, s, 'more', 'after'))).toEqual([409, 'chat_archived']);
    endTurn(s.runner as FakeRunner, first.turnId);
    expect(await ended(w.t.db, waiting.id)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('archived'),
    });
  });
});

describe('POST chats/:chatId/turns with a delivery: interrupt', () => {
  it('stops the running turn and starts first, numbered after it; the rest follow, numbered in start order', async () => {
    const s = await scene(w);
    const runner = s.runner as FakeRunner;
    const first = await runningTurn(w, s);
    const after = await queued(w, s, 'after it');
    const interrupt = await queued(w, s, 'Stop, do this', 'interrupt');
    expect(interrupt).toMatchObject({ seq: 3, delivery: 'interrupt', status: 'queued' });
    expect((await detailOf(w, s)).queue).toEqual([interrupt.id, after.id]);
    expect(await runner.frames.next('turn.stop')).toEqual({ type: 'turn.stop', turnId: first.turnId });
    endTurn(runner, first.turnId, { ok: false, exitCode: null, error: 'stopped' });
    expect((await runner.frames.next('turn.start')).turnId).toBe(interrupt.id);
    expect(await turnRow(w.t.db, first.turnId)).toMatchObject({ status: 'stopped' });
    endTurn(runner, interrupt.id);
    expect((await runner.frames.next('turn.start')).turnId).toBe(after.id);
    expect(await turnRow(w.t.db, after.id)).toMatchObject({ status: 'running', seq: 4 });
  });
});

describe('POST chats/:chatId/turns with a delivery: now', () => {
  it('sends turn.input into the running Claude Code turn; the harness’s echo removes the waiting message', async () => {
    const s = await scene(w);
    const runner = s.runner as FakeRunner;
    const first = await runningTurn(w, s);
    const now = await queued(w, s, 'Use staging', 'now');
    expect(now).toMatchObject({ status: 'queued', delivery: 'now' });
    expect(await runner.frames.next('turn.input')).toEqual({
      type: 'turn.input',
      turnId: first.turnId,
      inputId: now.id,
      text: 'Use staging',
    });
    sendEvents(runner, first.turnId, [{ type: 'input', text: 'Use staging', inputId: now.id }], 3);
    await eventually(
      'the waiting message is gone',
      async () => (await turnRow(w.t.db, now.id)) === undefined,
    );
    expect((await eventRows(w.t.db, first.turnId)).at(-1)?.event).toEqual({
      type: 'input',
      text: 'Use staging',
      inputId: now.id,
    });
    endTurn(runner, first.turnId);
    await ended(w.t.db, first.turnId);
    expect((await detailOf(w, s)).turns.map((turn) => turn.id)).toEqual([first.turnId]);
  });

  it('starts the message first when the turn ended without taking it', async () => {
    const s = await scene(w);
    const runner = s.runner as FakeRunner;
    const first = await runningTurn(w, s);
    const after = await queued(w, s, 'after it');
    const now = await queued(w, s, 'Use staging', 'now');
    await runner.frames.next('turn.input');
    endTurn(runner, first.turnId);
    expect(await runner.frames.next('turn.start')).toMatchObject({
      turnId: now.id,
      spec: { prompt: 'Use staging' },
    });
    expect(await turnRow(w.t.db, after.id)).toMatchObject({ status: 'queued' });
  });

  it('is refused for Codex and while the conversation compacts', async () => {
    const codex = await scene(w, { harness: 'codex' });
    await runningTurn(w, codex);
    expect(refusal(await sendWith(w, codex, 'x', 'now'))).toEqual([409, 'now_unsupported']);
    const s = await scene(w);
    const first = await runningTurn(w, s);
    endTurn(s.runner as FakeRunner, first.turnId);
    await ended(w.t.db, first.turnId);
    expect((await as(w, s.company.owner)('POST', chatPath(s.company, s.chat.id, '/compact'))).status).toBe(
      202,
    );
    expect(refusal(await sendWith(w, s, 'x', 'now'))).toEqual([409, 'now_unsupported']);
    expect((await sendWith(w, s, 'x', 'after')).status).toBe(202);
  });
});
