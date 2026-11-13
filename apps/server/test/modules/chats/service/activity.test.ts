import { tenant } from '@mwc/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activityOf, listsAnew, streamActivity } from '../../../../src/modules/chats/service/activity.ts';
import { type ChatMessage, chatBus } from '../../../../src/modules/chats/service/bus.ts';
import type { StreamTimers } from '../../../../src/modules/chats/service/stream.ts';
import { type ChatsWorld, chatsWorld, scene } from '../../../fixtures/chats/world.ts';
import { eventually } from '../../../fixtures/platform/realtime.ts';

/**
 * The chats' activity (2026-11-13, `service/activity.ts`) and the bus's watchers: which messages may change a chat's
 * place in a list, a chat read through the caller's tenant only, one read per burst of a chat's messages, the heartbeat,
 * and a failed write that stops nothing.
 */

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterAll(() => w.close());

const turnMessage = (chatId: string, status: string) =>
  ({ kind: 'turn', turn: { id: 't', chatId, status } }) as unknown as ChatMessage;

const eventMessage = (type: string) =>
  ({ kind: 'event', event: { turnId: 't', turnSeq: 1, seq: 1, event: { type }, at: '' } }) as unknown as ChatMessage;

/** Timers whose interval the test fires by hand. */
function handTimers() {
  const callbacks: (() => void)[] = [];
  const timers: StreamTimers = {
    setInterval: (callback) => callbacks.push(callback),
    clearInterval: () => callbacks.splice(0),
  };
  return { timers, tick: () => callbacks.forEach((callback) => callback()), count: () => callbacks.length };
}

describe('the bus’s watchers', () => {
  it('hear every chat’s messages and a chat changed, which no chat’s own listener hears; one that throws stops nothing', () => {
    const bus = chatBus();
    const heard: string[] = [];
    const own: string[] = [];
    bus.subscribe('a', (m) => own.push(m.kind));
    const unwatch = bus.watch(() => {
      throw new Error('closed');
    });
    bus.watch((chatId, activity) => heard.push(`${chatId} ${activity.kind}`));
    bus.publish('a', turnMessage('a', 'running'));
    bus.publish('b', { kind: 'removed', turnId: 't' });
    bus.changed('c');
    expect(heard).toEqual(['a turn', 'b removed', 'c chat']);
    expect(own).toEqual(['turn']);
    expect(bus.watching()).toBe(2);
    unwatch();
    expect(bus.watching()).toBe(1);
  });
});

describe('the chats’ activity', () => {
  it('lists a chat anew for a turn, a waiting turn gone, a question and a change, never for another event', () => {
    expect(listsAnew(turnMessage('a', 'done'))).toBe(true);
    expect(listsAnew({ kind: 'removed', turnId: 't' })).toBe(true);
    expect(listsAnew({ kind: 'chat' })).toBe(true);
    expect(listsAnew(eventMessage('question'))).toBe(true);
    expect(listsAnew(eventMessage('text'))).toBe(false);
  });

  it('reads a chat through the caller’s tenant: none for another company’s or an unknown one', async () => {
    const s = await scene(w);
    const other = await scene(w);
    const t = await tenant(w.t.db, s.company.companyId);
    expect(await activityOf(t, s.chat.id)).toEqual({ chat: s.chat, lastTurn: null });
    expect(await activityOf(t, other.chat.id)).toBeUndefined();
    expect(await activityOf(t, 'nope')).toBeUndefined();
  });

  it('sends a chat once per burst, beats, never sends another company’s, and stops nothing on a failed write', async () => {
    const s = await scene(w);
    const other = await scene(w);
    const t = await tenant(w.t.db, s.company.companyId);
    const bus = chatBus();
    const hand = handTimers();
    const written: string[] = [];
    let failNext = true;
    const sink = {
      message: async (_event: 'chat', data: string) => {
        const id = (JSON.parse(data) as { chat: { id: string } }).chat.id;
        if (failNext) {
          failNext = false;
          throw new Error('the stream closed');
        }
        written.push(id);
      },
      comment: async (text: string) => void written.push(`: ${text}`),
    };
    let close = () => {};
    const closed = new Promise<void>((resolve) => {
      close = resolve;
    });
    const streaming = streamActivity({ bus, timers: hand.timers, heartbeatMs: 1 }, t, sink, closed);
    bus.changed(s.chat.id);
    await eventually('the failed write', () => !failNext);
    bus.publish(other.chat.id, turnMessage(other.chat.id, 'running'));
    bus.publish(s.chat.id, eventMessage('text'));
    bus.publish(s.chat.id, turnMessage(s.chat.id, 'running'));
    bus.publish(s.chat.id, turnMessage(s.chat.id, 'done'));
    hand.tick();
    await eventually('the chat and a heartbeat', () => written.includes(': heartbeat'));
    bus.publish(other.chat.id, turnMessage(other.chat.id, 'done'));
    close();
    await streaming;
    expect(written).toEqual([': open', s.chat.id, ': heartbeat']);
    expect([bus.watching(), hand.count()]).toEqual([0, 0]);
  });
});
