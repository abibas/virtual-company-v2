import type { TurnEvent } from '@mwc/shared/harness';
import type { TurnStart } from '@mwc/shared/runner-protocol';
import type { FakeRunner } from '@mwc/testkit/runner';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  chatPath,
  ended,
  endTurn,
  eventRows,
  eventually,
  sendEvents,
  turnRow,
} from '../../../fixtures/chats/world.ts';
import {
  type InboundScene,
  type InboundWorld,
  inboundScene,
  inboundWorld,
  message,
  postsOf,
} from '../../../fixtures/integrations/slack-inbound.ts';
import { as } from '../../../fixtures/members/members.ts';

/**
 * A long Slack conversation compacted before its next message (2026-11-14, docs/harness.md "Slack conversations"): at
 * 60% of its window by the last reading, the next message's turn waits behind a `/compact` turn Most Wanted queued (the
 * thread's "Compacted to keep this conversation short"), at once or behind the running turn; below it, after a Clear,
 * or while another message already waits, nothing is compacted.
 */

let w: InboundWorld;

beforeAll(async () => {
  w = await inboundWorld();
});
afterEach(() => {
  w.provider.reset();
});
afterAll(async () => {
  await w.disconnectAll();
  await w.close();
});

const WINDOW = 200_000;
const sessionOf = (start: TurnStart) => `session-${start.turnId.slice(0, 8)}`;

/** A reading of the conversation's size: `used` of the window. */
const reading = (used: number): TurnEvent => ({
  type: 'context',
  inputTokens: used - 1000,
  cacheReadTokens: 1000,
  cacheCreationTokens: 0,
  outputTokens: 10,
  window: WINDOW,
});

/** A fresh mention's turn, its conversation measured at `used`, still running unless `end`. */
async function firstTurn(s: InboundScene, used: number, end = true) {
  const first = message();
  await s.conn.deliver(first);
  const runner = s.runner as FakeRunner;
  const start = await runner.frames.next('turn.start');
  sendEvents(runner, start.turnId, [{ type: 'session', sessionId: sessionOf(start) }, reading(used)]);
  if (end) await answer(runner, start, 3);
  return { first, start, chatId: (await turnRow(w.t.db, start.turnId))?.chatId as string };
}

/** The runner answers the turn (its events from `from`) and the answer is posted. */
async function answer(runner: FakeRunner, start: TurnStart, from = 1) {
  const before = postsOf(w).length;
  sendEvents(runner, start.turnId, [{ type: 'result', ok: true, text: 'Done.', durationMs: 10 }], from);
  endTurn(runner, start.turnId);
  await ended(w.t.db, start.turnId);
  await eventually('the answer is posted', () => postsOf(w).length > before);
}

/** The runner's compaction: its sizes, then the end. */
function compacts(runner: FakeRunner, start: TurnStart) {
  sendEvents(runner, start.turnId, [
    { type: 'compact', preTokens: 120_000, postTokens: 20_000, trigger: 'manual' },
    { type: 'result', ok: true, text: '', durationMs: 10 },
  ]);
  endTurn(runner, start.turnId);
}

const reply = (first: { readonly ts: string }, text: string) =>
  message({ type: 'message', text, threadTs: first.ts });

describe('a Slack conversation at its threshold', () => {
  it('compacts first, as a turn Most Wanted queued, then answers the message on the same session', async () => {
    const s = await inboundScene(w);
    const runner = s.runner as FakeRunner;
    const { first, start, chatId } = await firstTurn(s, 0.6 * WINDOW);
    await s.conn.deliver(reply(first, 'and now?'));
    const compaction = await runner.frames.next('turn.start');
    expect(compaction.spec.prompt).toBe('/compact');
    expect(compaction.spec.sessionId).toBe(sessionOf(start));
    expect(await turnRow(w.t.db, compaction.turnId)).toMatchObject({ kind: 'compact', system: true, chatId });
    compacts(runner, compaction);
    const next = await runner.frames.next('turn.start');
    expect(next.spec.prompt).toContain('and now?');
    expect(await turnRow(w.t.db, next.turnId)).toMatchObject({ kind: 'message', chatId });
    await answer(runner, next);
    const detail = await as(w, s.company.owner)('GET', chatPath(s.company, chatId));
    const turns = (detail.body as { turns: { kind: string; system: boolean; status: string }[] }).turns;
    expect(turns.map((turn) => [turn.kind, turn.system, turn.status])).toEqual([
      ['message', true, 'done'],
      ['compact', true, 'done'],
      ['message', true, 'done'],
    ]);
    expect(postsOf(w).map((post) => post.text)).toEqual(['Done.', 'Done.']);
  });

  it('queues the compaction behind a running turn, once, before the messages that come', async () => {
    const s = await inboundScene(w);
    const runner = s.runner as FakeRunner;
    const { first, start } = await firstTurn(s, 0.7 * WINDOW, false);
    await eventually('the reading is kept', async () => (await eventRows(w.t.db, start.turnId)).length === 2);
    await s.conn.deliver(reply(first, 'one'));
    await s.conn.deliver(reply(first, 'two'));
    await answer(runner, start, 3);
    const compaction = await runner.frames.next('turn.start');
    expect(compaction.spec.prompt).toBe('/compact');
    compacts(runner, compaction);
    const one = await runner.frames.next('turn.start');
    expect(one.spec.prompt).toContain('one');
    await answer(runner, one);
    const two = await runner.frames.next('turn.start');
    expect(two.spec.prompt).toContain('two');
    endTurn(runner, two.turnId);
  });
});

describe('a Slack conversation that needs no compaction', () => {
  it('below its threshold, and after a Clear, answers the message at once', async () => {
    const s = await inboundScene(w);
    const runner = s.runner as FakeRunner;
    const { first, chatId } = await firstTurn(s, 0.6 * WINDOW - 1);
    await s.conn.deliver(reply(first, 'below'));
    const next = await runner.frames.next('turn.start');
    expect(next.spec.prompt).toContain('below');
    sendEvents(runner, next.turnId, [reading(0.9 * WINDOW)]);
    await answer(runner, next, 2);
    const cleared = await as(w, s.company.owner)('POST', chatPath(s.company, chatId, '/clear'));
    expect(cleared.status).toBe(200);
    await s.conn.deliver(reply(first, 'after the clear'));
    const fresh = await runner.frames.next('turn.start');
    expect(fresh.spec.prompt).toContain('after the clear');
    expect(fresh.spec.sessionId).toBeNull();
    endTurn(runner, fresh.turnId);
  });
});
