import { chatTurns, tenant } from '@mwc/db';
import { newId } from '@mwc/shared/ids';
import { TEST_NOW } from '@mwc/testkit';
import type { FakeRunner } from '@mwc/testkit/runner';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ChatTurnView } from '../../../../src/modules/chats/schemas.ts';
import { detailOf, queued, runningTurn, turnPath } from '../../../fixtures/chats/queue.ts';
import {
  type ChatsWorld,
  chatPath,
  chatsWorld,
  endTurn,
  scene,
  turnRow,
} from '../../../fixtures/chats/world.ts';
import { addMember, as } from '../../../fixtures/members/members.ts';

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

describe('PATCH chats/:chatId/turns/:turnId', () => {
  it('changes a waiting message’s prompt, which is what starts later', async () => {
    const s = await scene(w);
    const first = await runningTurn(w, s);
    const waiting = await queued(w, s, 'And 3 + 3?');
    const owner = as(w, s.company.owner);
    const res = await owner('PATCH', turnPath(s, waiting.id), { prompt: 'And 4 + 4?' });
    expect([res.status, (res.body as ChatTurnView).prompt]).toEqual([200, 'And 4 + 4?']);
    expect(refusal(await owner('PATCH', turnPath(s, waiting.id), { prompt: '' }))).toEqual([
      400,
      'invalid_request',
    ]);
    endTurn(s.runner as FakeRunner, first.turnId);
    expect((await (s.runner as FakeRunner).frames.next('turn.start')).spec.prompt).toBe('And 4 + 4?');
    expect(refusal(await owner('PATCH', turnPath(s, waiting.id), { prompt: 'too late' }))).toEqual([
      409,
      'turn_not_queued',
    ]);
  });

  it('refuses one sent Now, an unknown chat or turn, and members', async () => {
    const s = await scene(w);
    await runningTurn(w, s);
    const now = await queued(w, s, 'Use staging', 'now');
    const owner = as(w, s.company.owner);
    expect(refusal(await owner('PATCH', turnPath(s, now.id), { prompt: 'x' }))).toEqual([
      409,
      'message_sent',
    ]);
    expect(refusal(await owner('PATCH', turnPath(s, 'nope'), { prompt: 'x' }))).toEqual([
      404,
      'turn_not_found',
    ]);
    const unknownChat = chatPath(s.company, 'nope', `/turns/${now.id}`);
    expect(refusal(await owner('PATCH', unknownChat, { prompt: 'x' }))).toEqual([404, 'chat_not_found']);
    const member = await addMember(w, s.company, 'member');
    expect((await as(w, member)('PATCH', turnPath(s, now.id), { prompt: 'x' })).status).toBe(403);
  });
});

describe('DELETE chats/:chatId/turns/:turnId', () => {
  it('discards a waiting message, never the running turn', async () => {
    const s = await scene(w);
    const first = await runningTurn(w, s);
    const waiting = await queued(w, s, 'later');
    const owner = as(w, s.company.owner);
    expect((await owner('DELETE', turnPath(s, waiting.id))).status).toBe(204);
    expect(await turnRow(w.t.db, waiting.id)).toBeUndefined();
    expect((await detailOf(w, s)).queue).toEqual([]);
    expect(refusal(await owner('DELETE', turnPath(s, waiting.id)))).toEqual([404, 'turn_not_found']);
    expect(refusal(await owner('DELETE', turnPath(s, first.turnId)))).toEqual([409, 'turn_not_queued']);
    const member = await addMember(w, s.company, 'member');
    expect((await as(w, member)('DELETE', turnPath(s, first.turnId))).status).toBe(403);
  });

  it('refuses in an archived chat', async () => {
    const s = await scene(w);
    await runningTurn(w, s);
    const waiting = await queued(w, s, 'later');
    const owner = as(w, s.company.owner);
    expect((await owner('DELETE', chatPath(s.company, s.chat.id))).status).toBe(204);
    expect(refusal(await owner('DELETE', turnPath(s, waiting.id)))).toEqual([409, 'chat_archived']);
  });
});

describe('POST chats/:chatId/turns/:turnId/deliver', () => {
  it('makes a waiting message interrupt: the running turn stops and it starts first', async () => {
    const s = await scene(w);
    const runner = s.runner as FakeRunner;
    const first = await runningTurn(w, s);
    const older = await queued(w, s, 'older');
    const waiting = await queued(w, s, 'this one');
    const res = await as(w, s.company.owner)('POST', turnPath(s, waiting.id, '/deliver'), {
      delivery: 'interrupt',
    });
    expect([res.status, (res.body as ChatTurnView).delivery]).toEqual([202, 'interrupt']);
    expect((await runner.frames.next('turn.stop')).turnId).toBe(first.turnId);
    expect((await detailOf(w, s)).queue).toEqual([waiting.id, older.id]);
    endTurn(runner, first.turnId, { ok: false, exitCode: null, error: 'stopped' });
    expect((await runner.frames.next('turn.start')).turnId).toBe(waiting.id);
  });

  it('sends a waiting message into the running turn now, refused for Codex', async () => {
    const s = await scene(w);
    const runner = s.runner as FakeRunner;
    const first = await runningTurn(w, s);
    const waiting = await queued(w, s, 'Use staging');
    const owner = as(w, s.company.owner);
    const res = await owner('POST', turnPath(s, waiting.id, '/deliver'), { delivery: 'now' });
    expect([res.status, (res.body as ChatTurnView).delivery]).toEqual([202, 'now']);
    expect(await runner.frames.next('turn.input')).toMatchObject({
      turnId: first.turnId,
      inputId: waiting.id,
    });
    expect(refusal(await owner('POST', turnPath(s, waiting.id, '/deliver'), { delivery: 'now' }))).toEqual([
      409,
      'message_sent',
    ]);
    const codex = await scene(w, { harness: 'codex' });
    await runningTurn(w, codex);
    const other = await queued(w, codex, 'x');
    const refused = await as(w, codex.company.owner)('POST', turnPath(codex, other.id, '/deliver'), {
      delivery: 'now',
    });
    expect(refusal(refused)).toEqual([409, 'now_unsupported']);
  });

  it('starts a waiting message at once when nothing runs, and refuses a bad delivery and members', async () => {
    const s = await scene(w);
    // A message left waiting with nothing running (its turn ended before the queue started it).
    const t = await tenant(w.t.db, s.company.companyId);
    const id = newId();
    const createdBy = s.company.owner.principalId;
    await t.insert(chatTurns, {
      id,
      chatId: s.chat.id,
      seq: 1,
      prompt: 'left',
      delivery: 'after',
      createdBy,
    });
    const owner = as(w, s.company.owner);
    expect(refusal(await owner('POST', turnPath(s, id, '/deliver'), { delivery: 'after' }))).toEqual([
      400,
      'invalid_request',
    ]);
    const member = await addMember(w, s.company, 'member');
    expect((await as(w, member)('POST', turnPath(s, id, '/deliver'), { delivery: 'now' })).status).toBe(403);
    const res = await owner('POST', turnPath(s, id, '/deliver'), { delivery: 'now' });
    expect([res.status, (res.body as ChatTurnView).status, (res.body as ChatTurnView).delivery]).toEqual([
      202,
      'running',
      'now',
    ]);
    expect((await (s.runner as FakeRunner).frames.next('turn.start')).spec.prompt).toBe('left');
  });
});
