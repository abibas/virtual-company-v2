import { TEST_NOW } from '@mwc/testkit';
import type { FakeRunner } from '@mwc/testkit/runner';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { openStream, type SseMessage } from '../../../fixtures/chats/stream.ts';
import {
  ANSWER,
  type ChatsWorld,
  chatPath,
  chatsWorld,
  ended,
  endTurn,
  type Scene,
  scene,
  sendEvents,
  startedTurn,
} from '../../../fixtures/chats/world.ts';
import { addMember } from '../../../fixtures/members/members.ts';
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

async function listen(s: Scene, headers: Record<string, string> = {}, person: Person = s.company.owner) {
  const stream = await openStream(w.t.app, chatPath(s.company, s.chat.id, '/stream'), {
    authorization: `Bearer fake:${person.subject}`,
    ...headers,
  });
  streams.push(stream);
  return stream;
}

const shape = (messages: SseMessage[]) =>
  messages
    .filter((message) => message.comment === undefined)
    .map((message) =>
      message.event === 'turn'
        ? `turn ${(message.data as { turn: { status: string } }).turn.status}`
        : `event ${message.id} ${(message.data as { event: { type: string } }).event.type}`,
    );

describe('GET chats/:chatId/stream', () => {
  it('streams a turn as it runs: its start, each event with its id, and its end', async () => {
    const s = await scene(w);
    const stream = await listen(s);
    expect([stream.status, stream.contentType]).toEqual([200, 'text/event-stream']);
    const start = await startedTurn(w, s);
    const runner = s.runner as FakeRunner;
    sendEvents(runner, start.turnId, ANSWER);
    endTurn(runner, start.turnId);
    await stream.until('the end', (messages) => shape(messages).includes('turn done'));
    expect(shape(stream.messages)).toEqual([
      'turn running',
      'event 1.1 session',
      'event 1.2 text',
      'event 1.3 usage',
      'event 1.4 result',
      'turn done',
    ]);
    expect(stream.messages[2]?.data).toEqual({
      turnId: start.turnId,
      turnSeq: 1,
      seq: 2,
      event: { type: 'text', text: '4' },
      at: TEST_NOW,
    });
  });

  it('replays what came after Last-Event-ID: the turns from its turn on, then the later events', async () => {
    const s = await scene(w);
    const start = await startedTurn(w, s);
    sendEvents(s.runner as FakeRunner, start.turnId, ANSWER);
    endTurn(s.runner as FakeRunner, start.turnId);
    await ended(w.t.db, start.turnId);
    const after = await listen(s, { 'last-event-id': '1.2' });
    await after.until('the replay', (messages) => shape(messages).length === 3);
    expect(shape(after.messages)).toEqual(['turn done', 'event 1.3 usage', 'event 1.4 result']);
    const all = await listen(s, { 'last-event-id': '1.0' });
    await all.until('the replay', (messages) => shape(messages).length === 5);
    expect(shape(all.messages)[0]).toBe('turn done');
    const next = await startedTurn(w, s, 'And 3 + 3?');
    const later = await listen(s, { 'last-event-id': '1.4' });
    await later.until('the new turn', (messages) => shape(messages).length === 2);
    expect(shape(later.messages)).toEqual(['turn done', 'turn running']);
    sendEvents(s.runner as FakeRunner, next.turnId, [{ type: 'text', text: '6' }]);
    await later.until('its event', (messages) => shape(messages).includes('event 2.1 text'));
  });

  it('ignores a Last-Event-ID that is not one, and sends only what happens from then on', async () => {
    const s = await scene(w);
    const start = await startedTurn(w, s);
    const stream = await listen(s, { 'last-event-id': 'garbage' });
    sendEvents(s.runner as FakeRunner, start.turnId, ANSWER.slice(0, 1));
    await stream.until('the event', (messages) => shape(messages).length === 1);
    expect(shape(stream.messages)).toEqual(['event 1.1 session']);
  });

  it('is for members and above, and a 404 for an unknown chat', async () => {
    const s = await scene(w, { offline: true });
    const member = await listen(s, {}, await addMember(w, s.company, 'member'));
    expect(member.status).toBe(200);
    const viewer = await listen(s, {}, await addMember(w, s.company, 'viewer'));
    expect(viewer.status).toBe(403);
    const unknown = await openStream(w.t.app, chatPath(s.company, 'nope', '/stream'), {
      authorization: `Bearer fake:${s.company.owner.subject}`,
    });
    streams.push(unknown);
    expect(unknown.status).toBe(404);
  });
});
