import { companies, flows, tasks } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { brokenDb, captureLogger, TEST_NOW } from '@mwc/testkit';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { TaskTurns } from '../../../../../src/modules/chats/index.ts';
import {
  AUTO_TAKE_START_DELAY_MS,
  autoTakeAtStart,
} from '../../../../../src/modules/tasks/service/auto-take.ts';
import { type ChatsWorld, chatPath, chatsWorld } from '../../../../fixtures/chats/world.ts';
import { as } from '../../../../fixtures/members/members.ts';
import { manualTimers } from '../../../../fixtures/platform/jobs.ts';
import { eventually, finish, runScene, taskRow } from '../../../../fixtures/runs.ts';
import { autoTakeOn, keysIn, storedStates } from '../../../../fixtures/tasks/queue.ts';
import { makeFlow, makeTask, stepOf, type TeamCompany, teamCompany } from '../../../../fixtures/tasks.ts';
import { toolCall, toolScene } from '../../../../fixtures/tools.ts';

/** The Lead wake-up tick's timers: the first one set is the server's one auto-take at its start (T-25). */
const ticks = manualTimers();
let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld({}, { leadWakeTimers: ticks.timers });
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

/** Three Autotake tasks queued in the team's flow while Autotake is off. */
async function queuedThree(c: TeamCompany, flowId: string): Promise<void> {
  for (const n of [1, 2, 3]) await makeTask(w, c, c.owner, { flowId, title: `Queued ${n}`, autoTake: true });
}

/** Autotake turned on straight in the table, as if while the server was down: nothing took yet. */
const turnedOnQuietly = (flowIds: string[]) =>
  rawDb(w.t.db).update(flows).set({ autoTake: true }).where(inArray(flows.id, flowIds));

describe('the take at the server’s start', () => {
  it('waits 30 s, then each flow with Autotake on takes what it missed; a deleted company’s are left alone', async () => {
    expect(ticks.pending()[0]).toBe(AUTO_TAKE_START_DELAY_MS);
    expect(AUTO_TAKE_START_DELAY_MS).toBe(30_000);
    const [live, gone, off] = [await teamCompany(w), await teamCompany(w), await teamCompany(w)] as const;
    const flowIds: string[] = [];
    for (const c of [live, gone, off]) {
      const flow = await makeFlow(w, c);
      await queuedThree(c, flow.id);
      flowIds.push(flow.id);
    }
    const [liveFlow, goneFlow, offFlow] = flowIds as [string, string, string];
    await turnedOnQuietly([liveFlow, goneFlow]);
    await rawDb(w.t.db)
      .update(companies)
      .set({ status: 'deleted', deletedAt: new Date(TEST_NOW) })
      .where(eq(companies.id, gone.companyId));
    await ticks.fire();
    expect(await storedStates(w.t.db, liveFlow)).toEqual([
      ['T-1', 'active'],
      ['T-2', 'active'],
      ['T-3', 'queued'],
    ]);
    for (const flowId of [goneFlow, offFlow])
      expect((await storedStates(w.t.db, flowId)).map(([, state]) => state)).toEqual([
        'queued',
        'queued',
        'queued',
      ]);
  });

  it('logs a flow whose take fails and goes on with the others', async () => {
    const c = await teamCompany(w);
    const auto = [{ name: 'Develop', kind: 'work', assigneePrincipalId: c.developer, starts: 'auto' }];
    const failing = await makeFlow(w, c, { steps: auto, name: 'Starts by itself' });
    const fine = await makeFlow(w, { ...c, lead: c.qaBot }, { name: 'By hand' });
    await queuedThree(c, failing.id); // T-1…T-3
    await queuedThree(c, fine.id); // T-4…T-6
    await turnedOnQuietly([failing.id, fine.id]);
    const timers = manualTimers();
    const { logger, lines } = captureLogger();
    const steps = { start: () => Promise.reject(new Error('The runner went away')) } as unknown as TaskTurns;
    autoTakeAtStart({ db: w.t.db, clock: w.clock, logger, steps }, timers.timers);
    expect(timers.pending()).toEqual([AUTO_TAKE_START_DELAY_MS]);
    await timers.fire();
    const failed = lines.filter((line) => line.msg === 'tasks: an auto-take at start failed');
    expect(failed.filter((line) => line.flowId === failing.id)).toHaveLength(1);
    expect(failed.filter((line) => line.flowId === fine.id)).toEqual([]);
    expect(await keysIn(w, c, fine.id, 'active')).toEqual(['T-5', 'T-4']);
    // The failing flow's takes were written before its first run failed to start.
    expect(await keysIn(w, c, failing.id, 'active')).toEqual(['T-2', 'T-1']);
  });

  it('logs a failure to list the flows', async () => {
    const timers = manualTimers();
    const { logger, lines } = captureLogger();
    autoTakeAtStart({ db: brokenDb(), clock: w.clock, logger }, timers.timers);
    await timers.fire();
    expect(lines.map((line) => line.msg)).toEqual(['tasks: the auto-take at start failed']);
  });
});

describe('a taken task’s run', () => {
  it('starts at a first step that starts by itself, the turn the flow Lead’s', async () => {
    const s = await runScene(w);
    await autoTakeOn(w, s.c, s.flow.id, 1);
    const task = await makeTask(w, s.c, s.c.member, { flowId: s.flow.id, autoTake: true });
    expect(task).toMatchObject({ state: 'active', step: { name: 'Develop' }, stepState: 'working' });
    const start = await s.runner.frames.next('turn.start');
    expect(start.spec.prompt).toContain('T-1');
    expect(task.history.map((e) => [e.kind, e.actor?.principalId ?? null])).toEqual([
      ['created', s.c.member.principalId],
      ['routed', null],
      ['entered', null],
      ['started', null],
    ]);
    const chatId = task.conversations[0]?.chatId as string;
    const chat = await as(w, s.c.owner)('GET', chatPath(s.c, chatId));
    expect(chat.body).toMatchObject({ turns: [{ createdBy: s.c.lead }] });
    finish(s.runner, start, 'Done.');
  });

  it('an agent’s decision that escalates a task takes the next one', async () => {
    const s = await toolScene(w);
    const review = stepOf(s.flow, 'Code review').id;
    const first = await makeTask(w, s.c, s.c.owner, { flowId: s.flow.id, stepId: review });
    const start = await s.runner.frames.next('turn.start');
    await autoTakeOn(w, s.c, s.flow.id, 1);
    const next = await makeTask(w, s.c, s.c.owner, { flowId: s.flow.id, autoTake: true });
    expect(next.state).toBe('queued');
    await rawDb(w.t.db)
      .update(tasks)
      .set({ rounds: { [review]: { entries: 1, sendBacks: 3 } } })
      .where(eq(tasks.id, first.id));
    const decided = await toolCall(s.runner, start.turnId, 'task_send_back', {
      reason: 'Still broken',
      findings: 'Same bug.',
    });
    expect(decided.ok).toBe(true);
    finish(s.runner, start, 'SEND BACK');
    const develop = await s.runner.frames.next('turn.start');
    expect(develop.spec.prompt).toContain('T-2');
    await eventually(
      'the next task is taken',
      async () => (await taskRow(w.t.db, next.id)).state === 'active',
    );
    expect((await taskRow(w.t.db, first.id)).state).toBe('escalated');
  });
});
