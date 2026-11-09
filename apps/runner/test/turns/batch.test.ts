import type { TurnEvent } from '@mwc/shared/harness';
import {
  EVENT_BATCH_MAX_EVENTS,
  encodeFrame,
  TURN_EVENTS_BATCH_BYTES,
  TURN_EVENTS_BATCH_MS,
  type TurnEventItem,
  utf8Bytes,
} from '@mwc/shared/runner-protocol';
import { describe, expect, it } from 'vitest';
import {
  EventBatcher,
  fitEvent,
  RESULT_EVENT_MAX_BYTES,
  TEXT_EVENT_MAX_BYTES,
} from '../../src/turns/batch.ts';
import { FakeTime } from '../fixtures/time.ts';

function newBatcher() {
  const time = new FakeTime();
  const batches: TurnEventItem[][] = [];
  return {
    time,
    batches,
    batcher: new EventBatcher({ timers: time, send: (events) => batches.push([...events]) }),
  };
}

const text = (value: string): TurnEvent => ({ type: 'text', text: value });

describe("a turn's events on their way", () => {
  it('are numbered from 1 and sent 100 ms after the first one', async () => {
    const { time, batches, batcher } = newBatcher();
    batcher.push([text('a'), text('b')]);
    batcher.push([text('c')]);
    expect(batches).toEqual([]);
    await time.advance(TURN_EVENTS_BATCH_MS);
    expect(batches).toEqual([
      [
        { seq: 1, event: text('a') },
        { seq: 2, event: text('b') },
        { seq: 3, event: text('c') },
      ],
    ]);
    batcher.flush();
    expect(batches).toHaveLength(1);
    expect(batcher.lastSeq).toBe(3);
  });

  it('reserve a number for an event sent on its own, and go on after it', async () => {
    const { time, batches, batcher } = newBatcher();
    batcher.push([text('a')]);
    batcher.flush();
    expect(batcher.reserve()).toBe(2);
    batcher.push([text('b')]);
    await time.advance(TURN_EVENTS_BATCH_MS);
    expect(batches).toEqual([[{ seq: 1, event: text('a') }], [{ seq: 3, event: text('b') }]]);
  });

  it('go at once from 32 KB or 100 events, and never pass the size in one frame', () => {
    const { time, batches, batcher } = newBatcher();
    batcher.push(Array.from({ length: EVENT_BATCH_MAX_EVENTS + 1 }, () => text('x')));
    expect(batches.map((batch) => batch.length)).toEqual([EVENT_BATCH_MAX_EVENTS]);
    batcher.flush();
    const big = 'y'.repeat(TEXT_EVENT_MAX_BYTES - 100);
    batcher.push([text(big), text(big)]);
    batcher.push([text(big)]);
    for (const batch of batches.slice(2)) {
      expect(utf8Bytes(JSON.stringify(batch))).toBeLessThanOrEqual(TURN_EVENTS_BATCH_BYTES);
    }
    batcher.flush();
    expect(batches.flat().map((item) => item.seq)).toEqual(Array.from({ length: 104 }, (_, i) => i + 1));
    expect(time.pending).toEqual([]);
  });

  it('split a text longer than a text event into pieces, keeping characters whole', () => {
    const long = `${'é'.repeat(TEXT_EVENT_MAX_BYTES)}😀${'\u0001'.repeat(TEXT_EVENT_MAX_BYTES)}`;
    const pieces = fitEvent(text(long));
    expect(pieces.length).toBeGreaterThan(2);
    expect(pieces.map((piece) => (piece.type === 'text' ? piece.text : '')).join('')).toBe(long);
    for (const piece of pieces)
      expect(utf8Bytes(JSON.stringify(piece))).toBeLessThanOrEqual(TEXT_EVENT_MAX_BYTES);
    expect(fitEvent(text('short'))).toEqual([text('short')]);
  });

  it("keep a subagent's parentId on each piece of its long text, within the size", () => {
    const parentId = `toolu_${'p'.repeat(190)}`;
    const pieces = fitEvent({ type: 'text', text: 'w'.repeat(TEXT_EVENT_MAX_BYTES * 2), parentId });
    expect(pieces.length).toBeGreaterThan(2);
    for (const piece of pieces) {
      expect(piece).toMatchObject({ type: 'text', parentId });
      expect(utf8Bytes(JSON.stringify(piece))).toBeLessThanOrEqual(TEXT_EVENT_MAX_BYTES);
    }
  });

  it("cut a result's text to fit one frame, and leave the other events as they are", () => {
    const result: TurnEvent = { type: 'result', ok: true, text: 'z'.repeat(RESULT_EVENT_MAX_BYTES * 2) };
    const [cut] = fitEvent(result);
    expect(utf8Bytes(JSON.stringify(cut))).toBeLessThanOrEqual(RESULT_EVENT_MAX_BYTES);
    expect(cut).toMatchObject({ type: 'result', ok: true, text: expect.stringMatching(/^z+…$/) });
    const usage: TurnEvent = { type: 'usage', inputTokens: 1, outputTokens: 2 };
    expect(fitEvent(usage)).toEqual([usage]);
    expect(fitEvent({ type: 'result', ok: false, error: 'x' })).toEqual([
      { type: 'result', ok: false, error: 'x' },
    ]);
    const { batches, batcher } = newBatcher();
    batcher.push([text('before'), result]);
    batcher.flush();
    expect(batches.map((batch) => batch.length)).toEqual([1, 1]);
    for (const batch of batches) {
      expect(() =>
        encodeFrame({ type: 'turn.events', turnId: crypto.randomUUID(), events: batch }),
      ).not.toThrow();
    }
  });
});
