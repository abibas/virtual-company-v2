import { brokenDb, captureLogger } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { leadWakes } from '../../../../../src/modules/tasks/index.ts';
import { endTurn, sendEvents } from '../../../../fixtures/chats/world.ts';
import { as } from '../../../../fixtures/members/members.ts';
import { manualTimers } from '../../../../fixtures/platform/jobs.ts';
import { answer, stepStateIs } from '../../../../fixtures/runs.ts';
import { flowsPath } from '../../../../fixtures/tasks.ts';
import {
  escalate,
  noticesOf,
  runDevelop,
  taskAt,
  teamChatsOf,
  tickPastWindow,
  turnsOf,
  type WakeScene,
  type WakeWorld,
  wakeEvents,
  wakeScene,
  wakeWorld,
} from '../../../../fixtures/wakes.ts';

/**
 * The wake-up tick (S6c): a flow's events wait their quiet window from the oldest the tick saw, then go as one turn;
 * a turn of the team chat that runs makes the next wake-up wait behind it, and a wake-up still waiting takes the next
 * one in; past a cap the Lead's nearest person is told once instead, and so when the Lead cannot run; a sign-off that
 * waited past the flow's hours wakes the Lead once.
 */

let w: WakeWorld;
beforeAll(async () => {
  w = await wakeWorld();
});
afterEach(() => w.disconnectAll());
afterAll(() => w.close());

const settings = (more: Record<string, unknown> = {}) => ({
  escalated: true,
  blocked: true,
  turnEnded: true,
  done: false,
  signoffHours: null,
  windowSeconds: 60,
  maxPerHour: 6,
  maxPerDay: 40,
  ...more,
});

async function putSettings(s: WakeScene, more: Record<string, unknown>) {
  const res = await as(w, s.c.owner)('PUT', flowsPath(s.c, `/${s.flow.id}/lead-wakes`), settings(more));
  expect(res.status).toBe(200);
}

/** A task blocked at Develop (its turn failed). */
async function blockedTask(s: WakeScene, title: string) {
  const task = await taskAt(w, s, 'Develop', title);
  await runDevelop(w, s, task.key, 'failed');
  await stepStateIs(w.t.db, task.id, 'blocked');
  return task;
}

describe('the wake-up tick', () => {
  it('waits the window from the first event it saw, and takes in what came meanwhile', async () => {
    const s = await wakeScene(w);
    const first = await blockedTask(s, 'First');
    await w.ticks.fire();
    w.clock.advance(30_000);
    const second = await blockedTask(s, 'Second');
    await w.ticks.fire();
    expect(await teamChatsOf(w.t.db, s.flow.id)).toEqual([]);
    w.clock.advance(30_000);
    await w.ticks.fire();
    const start = await s.runner.frames.next('turn.start');
    expect(start.spec.prompt).toContain(`${first.key} “First”`);
    expect(start.spec.prompt).toContain(`${second.key} “Second”`);
    expect(w.ticks.pending()).toEqual([5_000]);
  });

  it('queues behind the Lead’s running turn, takes a later one into the waiting turn, then runs it', async () => {
    const s = await wakeScene(w);
    await blockedTask(s, 'One');
    await tickPastWindow(w);
    const running = await s.runner.frames.next('turn.start');
    const two = await blockedTask(s, 'Two');
    await tickPastWindow(w);
    const [team] = await teamChatsOf(w.t.db, s.flow.id);
    const chatId = team?.id as string;
    const [, waiting] = await turnsOf(w.t.db, chatId);
    expect(waiting).toMatchObject({ status: 'queued', delivery: 'after', system: true, createdBy: s.c.lead });
    const three = await blockedTask(s, 'Three');
    await tickPastWindow(w);
    const turns = await turnsOf(w.t.db, chatId);
    expect(turns).toHaveLength(2);
    expect(turns[1]?.prompt).toContain(`${two.key} “Two”`);
    expect(turns[1]?.prompt).toContain(`${three.key} “Three”`);
    const events = await wakeEvents(w.t.db, s.flow.id);
    expect(events.map((e) => e.turnId)).toEqual([running.turnId, waiting?.id, waiting?.id]);

    sendEvents(s.runner, running.turnId, answer('Retried T-1.'));
    endTurn(s.runner, running.turnId);
    const next = await s.runner.frames.next('turn.start');
    expect(next.turnId).toBe(waiting?.id);
    expect(next.spec.prompt).toContain(`${three.key} “Three”`);
  });

  it('holds the wake-ups past the hour’s cap and tells the Lead’s nearest person once', async () => {
    const s = await wakeScene(w);
    await putSettings(s, { maxPerHour: 1 });
    await blockedTask(s, 'One');
    await tickPastWindow(w);
    const told = await s.runner.frames.next('turn.start');
    endTurn(s.runner, told.turnId);
    await blockedTask(s, 'Two');
    await tickPastWindow(w);
    await blockedTask(s, 'Three');
    await tickPastWindow(w);
    const events = await wakeEvents(w.t.db, s.flow.id);
    expect(events.map((e) => e.outcome)).toEqual(['woke', 'capped', 'capped']);
    expect(events[1]?.detail).toBe("Over the flow's wake-ups for this hour");
    const notices = await noticesOf(w.t.db, s.c.manager.principalId, 'lead_not_woken');
    expect(notices.map((n) => n.payload)).toEqual([{ about: s.c.lead, reason: 'hour_cap' }]);
    const list = await as(w, s.c.manager)('GET', `/api/companies/${s.c.companyId}/notifications`);
    expect(list.body).toMatchObject({
      notifications: expect.arrayContaining([
        expect.objectContaining({
          kind: 'lead_not_woken',
          text: "DEVBOX Coordinator was not woken for its team's tasks: it had all its wake-ups for this hour",
          path: `flows/${s.c.leadSlug}`,
        }),
      ]),
    });

    w.clock.advance(60 * 60_000);
    await blockedTask(s, 'Four');
    await tickPastWindow(w);
    expect((await s.runner.frames.next('turn.start')).spec.prompt).toContain('“Four”');
  });

  it('holds them past the day’s cap', async () => {
    const s = await wakeScene(w);
    await putSettings(s, { maxPerHour: 5, maxPerDay: 1 });
    await blockedTask(s, 'One');
    await tickPastWindow(w);
    endTurn(s.runner, (await s.runner.frames.next('turn.start')).turnId);
    w.clock.advance(2 * 60 * 60_000);
    await blockedTask(s, 'Two');
    await tickPastWindow(w);
    const [, held] = await wakeEvents(w.t.db, s.flow.id);
    expect(held).toMatchObject({ outcome: 'capped', detail: "Over the flow's wake-ups for today" });
    const notices = await noticesOf(w.t.db, s.c.manager.principalId, 'lead_not_woken');
    expect(notices.map((n) => n.payload)).toEqual([{ about: s.c.lead, reason: 'day_cap' }]);
  });

  it('records a Lead without a placement and tells its nearest person once', async () => {
    const s = await wakeScene(w, { leadUnplaced: true });
    const first = await taskAt(w, s, 'QA', 'First');
    await escalate(w, s, first.key);
    await tickPastWindow(w);
    const second = await taskAt(w, s, 'QA', 'Second');
    await escalate(w, s, second.key);
    await tickPastWindow(w);
    const events = await wakeEvents(w.t.db, s.flow.id);
    expect(events.map((e) => e.outcome)).toEqual(['unreachable', 'unreachable']);
    expect(events[0]?.detail).toBe('The agent has no placement: choose where it runs first');
    const notices = await noticesOf(w.t.db, s.c.manager.principalId, 'lead_not_woken');
    expect(notices.map((n) => n.payload)).toEqual([
      {
        about: s.c.lead,
        reason: 'unreachable',
        detail: 'The agent has no placement: choose where it runs first',
      },
    ]);
    expect(await teamChatsOf(w.t.db, s.flow.id)).toEqual([]);
    const view = await as(w, s.c.member)('GET', flowsPath(s.c, `/${s.flow.id}/lead-wakes`));
    expect(view.body).toMatchObject({
      leadIsAgent: true,
      chat: null,
      last: { outcome: 'unreachable', detail: 'The agent has no placement: choose where it runs first' },
      counts: { hour: 0, day: 0, pending: 0 },
    });
  });

  it('wakes the Lead once for a sign-off that waited past the flow’s hours', async () => {
    const s = await wakeScene(w);
    await putSettings(s, { signoffHours: 2 });
    const task = await taskAt(w, s, 'Approve', 'Ship it');
    await w.ticks.fire();
    expect(await wakeEvents(w.t.db, s.flow.id)).toEqual([]);
    w.clock.set(Date.now() + 3 * 60 * 60_000);
    await tickPastWindow(w);
    const start = await s.runner.frames.next('turn.start');
    expect(start.spec.prompt).toMatch(
      new RegExp(`- ${task.key} “Ship it” has waited [23] h for .+'s sign-off at Approve`),
    );
    expect(start.spec.prompt).toContain('Decide: remind them (ask_user_question), or leave it.');
    w.clock.advance(60 * 60_000);
    await tickPastWindow(w);
    expect((await wakeEvents(w.t.db, s.flow.id)).map((e) => e.kind)).toEqual(['signoff_waiting']);
  });
});

describe('the tick’s loop', () => {
  it('logs a tick that failed, ticks again, and stops with no timer left', async () => {
    const manual = manualTimers();
    const { logger, lines } = captureLogger();
    const wakes = leadWakes({
      db: brokenDb(),
      clock: () => new Date(),
      logger,
      timers: manual.timers,
      tickMs: 1_000,
    });
    wakes.start();
    expect(manual.pending()).toEqual([1_000]);
    await manual.fire();
    expect(lines.some((line) => line.msg === 'tasks: a Lead wake-up tick failed')).toBe(true);
    expect(manual.pending()).toEqual([1_000]);
    await wakes.stop();
    expect(manual.pending()).toEqual([]);
  });

  it('sets no new timer when it is stopped while a tick runs', async () => {
    const manual = manualTimers();
    const { logger } = captureLogger();
    const wakes = leadWakes({ db: brokenDb(), clock: () => new Date(), logger, timers: manual.timers });
    wakes.start();
    expect(manual.pending()).toEqual([5_000]);
    const ticking = manual.fire();
    await wakes.stop();
    await ticking;
    expect(manual.pending()).toEqual([]);
  });
});
