import { tenant } from '@mwc/db';
import { TEST_NOW } from '@mwc/testkit';
import type { FakeRunner } from '@mwc/testkit/runner';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chatBus } from '../../../../src/modules/chats/service/bus.ts';
import { type StreamSink, streamChat } from '../../../../src/modules/chats/service/stream.ts';
import {
  ANSWER,
  type ChatsWorld,
  chatsWorld,
  ended,
  endTurn,
  scene,
  sendEvents,
  startedTurn,
} from '../../../fixtures/chats/world.ts';

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
});
afterAll(() => w.close());

/** A sink that keeps what it got, as `event id` or `: comment`. */
function recordingSink() {
  const got: string[] = [];
  const sink: StreamSink = {
    message: async (event, data, id) => {
      got.push(id === undefined ? event : `${event} ${id}`);
      void data;
    },
    comment: async (text) => {
      got.push(`: ${text}`);
    },
  };
  return { got, sink };
}

/** Timers whose interval the test fires by hand. */
function manualInterval() {
  const fired: (() => void)[] = [];
  let cleared = 0;
  return {
    timers: {
      setInterval: (callback: () => void) => {
        fired.push(callback);
        return fired.length;
      },
      clearInterval: () => {
        cleared++;
      },
    },
    tick: () => {
      for (const callback of fired) callback();
    },
    cleared: () => cleared,
  };
}

describe('streamChat', () => {
  it('sends a heartbeat comment at each interval, and stops it when the stream closes', async () => {
    const s = await scene(w, { offline: true });
    const bus = chatBus();
    const manual = manualInterval();
    const { got, sink } = recordingSink();
    const close = Promise.withResolvers<void>();
    const done = streamChat(
      { bus, timers: manual.timers },
      await tenant(w.t.db, s.company.companyId),
      s.chat.id,
      undefined,
      sink,
      close.promise,
    );
    manual.tick();
    manual.tick();
    close.resolve();
    await done;
    expect(got).toEqual([': heartbeat', ': heartbeat']);
    expect(manual.cleared()).toBe(1);
    expect(bus.count(s.chat.id)).toBe(0);
  });

  it('never sends an event twice when it also comes live during the replay', async () => {
    const s = await scene(w);
    const start = await startedTurn(w, s);
    sendEvents(s.runner as FakeRunner, start.turnId, ANSWER);
    endTurn(s.runner as FakeRunner, start.turnId);
    await ended(w.t.db, start.turnId);
    const bus = chatBus();
    const { got, sink } = recordingSink();
    const close = Promise.withResolvers<void>();
    const done = streamChat(
      { bus, timers: manualInterval().timers },
      await tenant(w.t.db, s.company.companyId),
      s.chat.id,
      { turnSeq: 1, eventSeq: 2 },
      sink,
      close.promise,
    );
    // Heard while the replay reads the database: an event it replays, and a turn change.
    const event = { turnId: start.turnId, turnSeq: 1, seq: 3, event: ANSWER[2], at: TEST_NOW } as const;
    bus.publish(s.chat.id, { kind: 'event', event: event as never });
    bus.publish(s.chat.id, { kind: 'turn', turn: { id: start.turnId } as never });
    await new Promise((resolve) => setTimeout(resolve, 50));
    close.resolve();
    await done;
    expect(got).toEqual(['turn', 'event 1.3', 'event 1.4', 'turn']);
  });
});
