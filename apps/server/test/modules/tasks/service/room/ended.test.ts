import { TEST_NOW } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ended, endTurn } from '../../../../fixtures/chats/world.ts';
import { roomChatOf, roomLines, roomRows, said, startsByAgent } from '../../../../fixtures/room.ts';
import { finish } from '../../../../fixtures/runs.ts';
import { moved } from '../../../../fixtures/tasks.ts';
import {
  escalate,
  taskAt,
  tickPastWindow,
  turnsOf,
  type WakeWorld,
  wakeScene,
  wakeWorld,
} from '../../../../fixtures/wakes.ts';

/**
 * The Lead's turns in the team room (docs/processes.md "The team room"): a wake-up or a check-in shows as Most Wanted's
 * notice with its turn and the Lead's reply as the Lead's; a silent reply posts nothing, a failed turn says so and a
 * stopped one posts nothing. A person's message never goes into a wake-up's turn (nor a wake-up into a room turn): each
 * stays its own message, and its own turn queued behind the Lead's running one.
 */

let w: WakeWorld;
beforeAll(async () => {
  w = await wakeWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

const WAKE = 'Most Wanted · DEVBOX delivery: 1 task needs your decision.';

describe('the Lead’s wake-ups and check-ins in the team room', () => {
  it('shows a wake-up as Most Wanted’s notice with its turn, and the Lead’s reply as the Lead’s', async () => {
    const s = await wakeScene(w);
    await escalate(w, s, (await taskAt(w, s, 'QA')).key);
    await tickPastWindow(w);
    const start = await s.runner.frames.next('turn.start');
    const team = await roomChatOf(w.t.db, s.flow.id, s.c.lead);
    const [notice] = await roomRows(w.t.db, s.flow.id);
    expect(notice).toMatchObject({
      kind: 'notice',
      authorPrincipalId: null,
      body: start.spec.prompt,
      chatId: team?.id,
      turnId: start.turnId,
      details: { about: 'wake' },
    });
    finish(s.runner, start, 'Retried it at Develop.');
    await ended(w.t.db, start.turnId);
    expect((await roomLines(w.t.db, s.flow.id)).slice(1)).toEqual([['reply', s.c.lead, 'Retried it at Develop.']]);
  });

  it('posts nothing for a silent reply or a stopped turn, and a notice for a failed one', async () => {
    const s = await wakeScene(w);
    await said(w, s, s.c.owner, 'Quiet please');
    const first = await startsByAgent(w, s, 2);
    finish(s.runner, first.get(s.c.lead) as never, '  NOTHING_TO_ADD.  ');
    endTurn(s.runner, (first.get(s.c.developer) as { turnId: string }).turnId, {
      ok: false,
      exitCode: null,
      error: 'stopped',
    });
    await ended(w.t.db, (first.get(s.c.lead) as { turnId: string }).turnId);
    await ended(w.t.db, (first.get(s.c.developer) as { turnId: string }).turnId);
    expect((await roomLines(w.t.db, s.flow.id)).map(([kind]) => kind)).toEqual(['message']);

    await said(w, s, s.c.owner, '@developer try again');
    const again = await startsByAgent(w, s, 1);
    endTurn(s.runner, (again.get(s.c.developer) as { turnId: string }).turnId, {
      ok: false,
      exitCode: 1,
      error: 'spawn_failed: ENOENT',
    });
    await ended(w.t.db, (again.get(s.c.developer) as { turnId: string }).turnId);
    const last = (await roomRows(w.t.db, s.flow.id)).at(-1);
    expect(last).toMatchObject({ kind: 'notice', details: { about: 'failed' } });
    expect(last?.body).toMatch(/^Developer could not answer: The harness did not start on .+ \(ENOENT\)$/);
  });

  it('keeps a person’s message apart from a waiting wake-up: its own message, its own turn behind the Lead’s', async () => {
    const s = await wakeScene(w);
    await escalate(w, s, (await taskAt(w, s, 'QA')).key);
    await tickPastWindow(w);
    const wake = await s.runner.frames.next('turn.start');
    w.clock.advance(1000);
    await said(w, s, s.c.owner, 'Hold T-14 until the design is signed off.');
    const dev = await startsByAgent(w, s, 1);
    expect(dev.has(s.c.developer)).toBe(true);
    await escalate(w, s, (await taskAt(w, s, 'QA', 'Fix the logout')).key);
    await tickPastWindow(w);
    const team = await roomChatOf(w.t.db, s.flow.id, s.c.lead);
    const [running, room, nextWake] = await turnsOf(w.t.db, team?.id as string);
    expect(running).toMatchObject({ id: wake.turnId, status: 'running', roomMessageId: null });
    expect(room).toMatchObject({ status: 'queued', system: true, delivery: 'after' });
    expect(room?.roomMessageId).not.toBeNull();
    expect(room?.prompt).toContain('wrote:\nHold T-14 until the design is signed off.');
    expect(room?.prompt).not.toContain(WAKE);
    expect(nextWake).toMatchObject({ status: 'queued', system: true, roomMessageId: null });
    expect(nextWake?.prompt.startsWith(WAKE)).toBe(true);
    expect(nextWake?.prompt).not.toContain('Hold T-14');

    // A second message joins the Lead's room turn that still waits, not the wake-up.
    await said(w, s, s.c.manager, 'And T-15 too.');
    const after = await turnsOf(w.t.db, team?.id as string);
    expect(after).toHaveLength(3);
    expect(after[1]?.id).toBe(room?.id);
    expect(after[1]?.prompt).toContain('wrote:\nAnd T-15 too.');
    expect(after[1]?.prompt).toContain(': Hold T-14 until the design is signed off.');
    expect(after[2]?.prompt).toBe(nextWake?.prompt);
    expect((await roomLines(w.t.db, s.flow.id)).map(([kind, , body]) => [kind, body.split('\n')[0]])).toEqual([
      ['notice', WAKE],
      ['message', 'Hold T-14 until the design is signed off.'],
      ['notice', WAKE],
      ['message', 'And T-15 too.'],
    ]);
  });

  it('shows a check-in as Most Wanted’s notice', async () => {
    w.clock.set(Date.now());
    const s = await wakeScene(w);
    const task = await taskAt(w, s, 'Develop');
    await moved(w, s.c, s.c.owner, task.key, { action: 'start' });
    await s.runner.frames.next('turn.start');
    await w.ticks.fire();
    w.clock.advance(5 * 60_000);
    await w.ticks.fire();
    const start = await s.runner.frames.next('turn.start');
    const [notice] = await roomRows(w.t.db, s.flow.id);
    expect(notice).toMatchObject({ kind: 'notice', body: start.spec.prompt, details: { about: 'check_in' } });
    expect(notice?.body).toContain('Most Wanted · DEVBOX delivery: check-in, 1 open task.');
  });
});
