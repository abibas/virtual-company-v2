import { tenant } from '@mwc/db';
import type { TurnStart } from '@mwc/shared/runner-protocol';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { tasksRepo } from '../../../../../src/modules/tasks/repo.ts';
import { checkInFlow } from '../../../../../src/modules/tasks/service/wake/check-in.ts';
import { ended, endTurn, eventually } from '../../../../fixtures/chats/world.ts';
import { as } from '../../../../fixtures/members/members.ts';
import { stepStateIs } from '../../../../fixtures/runs.ts';
import { flowsPath, moved } from '../../../../fixtures/tasks.ts';
import {
  noticesOf,
  runDevelop,
  taskAt,
  teamChatsOf,
  type WakeScene,
  type WakeWorld,
  wakeEvents,
  wakeScene,
  wakeWorld,
} from '../../../../fixtures/wakes.ts';

/**
 * A flow Lead's check-ins (docs/processes.md "Check-ins"): every N minutes while its flow has work, the tick wakes the
 * Lead in its team chat with a digest of the open tasks, unless the Lead has a turn of its own, the flow's events wait
 * for their window, or nothing changed and nothing is stuck; a stuck task always gets one. They count toward the caps,
 * never start a stopped machine, and a Lead that cannot run is held as an event's wake-up is.
 */

let w: WakeWorld;
beforeAll(async () => {
  w = await wakeWorld();
});
// The history's rows carry the database's clock: the app's starts at it, so "5 min" reads as the clock moved.
beforeEach(() => w.clock.set(Date.now()));
afterEach(() => w.disconnectAll());
afterAll(() => w.close());

const MINUTE = 60_000;

/** The runner ends the Lead's turn, and its row has ended. */
async function endLead(s: WakeScene, turnId: string): Promise<void> {
  endTurn(s.runner, turnId);
  await ended(w.t.db, turnId);
}

async function putSettings(s: WakeScene, more: Record<string, unknown>) {
  const settings = {
    escalated: true,
    blocked: true,
    turnEnded: true,
    done: false,
    signoffHours: null,
    windowSeconds: 60,
    maxPerHour: 12,
    maxPerDay: 150,
    checkInMinutes: 5,
    ...more,
  };
  const res = await as(w, s.c.owner)('PUT', flowsPath(s.c, `/${s.flow.id}/lead-wakes`), settings);
  expect(res.status).toBe(200);
}

/** A task at Develop whose turn runs; the runner's `turn.start` for it. */
async function developing(s: WakeScene, title = 'Fix the login'): Promise<{ key: string; start: TurnStart }> {
  const task = await taskAt(w, s, 'Develop', title);
  await moved(w, s.c, s.c.owner, task.key, { action: 'start' });
  return { key: task.key, start: await s.runner.frames.next('turn.start') };
}

/** Ticks now (the flow's clock starts), then once `minutes` later. */
async function tickAfter(minutes: number): Promise<void> {
  await w.ticks.fire();
  w.clock.advance(minutes * MINUTE);
  await w.ticks.fire();
}

const checkIns = async (s: WakeScene) =>
  (await wakeEvents(w.t.db, s.flow.id)).filter((event) => event.kind === 'check_in');

describe('a flow’s check-ins', () => {
  it('wakes the Lead every 5 minutes with the board’s digest, as Most Wanted’s turn in its team chat', async () => {
    const s = await wakeScene(w);
    const { key } = await developing(s);
    await w.ticks.fire();
    w.clock.advance(4 * MINUTE);
    await w.ticks.fire();
    expect(await checkIns(s)).toEqual([]);
    w.clock.advance(MINUTE);
    await w.ticks.fire();

    const start = await s.runner.frames.next('turn.start');
    expect(start.spec.prompt).toContain('Most Wanted · DEVBOX delivery: check-in, 1 open task.');
    expect(start.spec.prompt).toMatch(
      new RegExp(`\\n- ${key} “Fix the login” · Develop · working [45] min · turn live\\n`),
    );
    expect(start.spec.prompt).toContain('then end your turn: never wait for a step’s agent');
    expect(start.spec.tools).toContain('team_board');
    const [team] = await teamChatsOf(w.t.db, s.flow.id);
    const [row] = await checkIns(s);
    expect(row).toMatchObject({ outcome: 'woke', taskId: null, chatId: team?.id, turnId: start.turnId });
  });

  it('skips while the Lead has a turn, and when nothing changed and nothing is stuck', async () => {
    const s = await wakeScene(w);
    await developing(s);
    await tickAfter(5);
    const told = await s.runner.frames.next('turn.start');
    w.clock.advance(5 * MINUTE);
    await w.ticks.fire();
    expect(await checkIns(s)).toHaveLength(1);

    await endLead(s, told.turnId);
    await stepStateIs(w.t.db, (await taskAt(w, s, 'Develop', 'Queued one')).id, 'waiting');
    w.clock.advance(5 * MINUTE);
    await w.ticks.fire();
    expect(await checkIns(s)).toHaveLength(2);
    await endLead(s, (await s.runner.frames.next('turn.start')).turnId);
    w.clock.advance(5 * MINUTE);
    await w.ticks.fire();
    expect(await checkIns(s)).toHaveLength(2);
  });

  it('always checks in on a stuck task, and counts toward the caps', async () => {
    const s = await wakeScene(w);
    await putSettings(s, { blocked: false, maxPerHour: 2 });
    const task = await taskAt(w, s, 'Develop', 'Breaks');
    await runDevelop(w, s, task.key, 'failed');
    await stepStateIs(w.t.db, task.id, 'blocked');
    await tickAfter(5);
    const first = await s.runner.frames.next('turn.start');
    expect(first.spec.prompt).toContain('check-in, 1 open task (1 stuck).');
    expect(first.spec.prompt).toMatch(
      new RegExp(`\\n- ${task.key} “Breaks” · Develop · blocked [45] min: The repo is missing\\n`),
    );
    await endLead(s, first.turnId);
    w.clock.advance(5 * MINUTE);
    await w.ticks.fire();
    await endLead(s, (await s.runner.frames.next('turn.start')).turnId);
    w.clock.advance(5 * MINUTE);
    await w.ticks.fire();
    const rows = await checkIns(s);
    expect(rows.map((row) => row.outcome)).toEqual(['woke', 'woke', 'capped']);
    expect(rows[2]?.detail).toBe("Over the flow's wake-ups for this hour");
    const notices = await noticesOf(w.t.db, s.c.manager.principalId, 'lead_not_woken');
    expect(notices.map((n) => n.payload)).toEqual([{ about: s.c.lead, reason: 'hour_cap' }]);
  });

  it('waits for the events’ own wake-up, and comes N minutes after it', async () => {
    const s = await wakeScene(w);
    const task = await taskAt(w, s, 'Develop', 'Breaks');
    await w.ticks.fire();
    w.clock.advance(5 * MINUTE);
    await runDevelop(w, s, task.key, 'failed');
    await stepStateIs(w.t.db, task.id, 'blocked');
    await w.ticks.fire();
    expect(await wakeEvents(w.t.db, s.flow.id)).toMatchObject([{ kind: 'blocked', outcome: 'pending' }]);
    w.clock.advance(MINUTE);
    await w.ticks.fire();
    await endLead(s, (await s.runner.frames.next('turn.start')).turnId);
    w.clock.advance(4 * MINUTE);
    await w.ticks.fire();
    expect(await checkIns(s)).toEqual([]);
    w.clock.advance(MINUTE);
    await w.ticks.fire();
    expect((await s.runner.frames.next('turn.start')).spec.prompt).toContain(
      'check-in, 1 open task (1 stuck).',
    );
  });

  it('never starts a stopped machine, holds a Lead that cannot run, and none with check-ins off or no work', async () => {
    const off = await wakeScene(w);
    await taskAt(w, off, 'Develop', 'Waits');
    await w.ticks.fire();
    await off.runner.disconnect();
    await eventually('the runner is gone', () => w.hub.connected(off.machineId) === undefined);
    w.clock.advance(5 * MINUTE);
    await w.ticks.fire();
    expect(await checkIns(off)).toEqual([]);

    const unplaced = await wakeScene(w, { leadUnplaced: true });
    await developing(unplaced);
    await tickAfter(5);
    expect(await checkIns(unplaced)).toMatchObject([
      { outcome: 'unreachable', detail: 'The agent has no placement: choose where it runs first' },
    ]);

    const quiet = await wakeScene(w);
    await putSettings(quiet, { checkInMinutes: null });
    await developing(quiet);
    await tickAfter(5);
    expect(await checkIns(quiet)).toEqual([]);
    const t = await tenant(w.t.db, quiet.c.companyId);
    const clock = { lookedAt: () => new Date(0), look: () => undefined, keepOnly: () => undefined };
    const of = { flowId: quiet.flow.id, minutes: 5, clock, now: w.clock() };
    expect(await checkInFlow({ db: w.t.db }, tasksRepo, t, of)).toBe('none');
    const justLooked = { ...clock, lookedAt: () => w.clock() };
    expect(await checkInFlow({ db: w.t.db }, tasksRepo, t, { ...of, clock: justLooked })).toBe('not_due');
  });
});
