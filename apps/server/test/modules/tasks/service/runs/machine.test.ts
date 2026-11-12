import { MACHINE_POWER_ERROR_MESSAGES } from '@mwc/machines-core';
import type { MachinePowerPolicyInput } from '@mwc/shared/machines';
import { TEST_NOW } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type BoxWorld, boxUp, boxWorld, logged } from '../../../../fixtures/chats/machine.ts';
import { place } from '../../../../fixtures/chats/world.ts';
import { boxDriver, connectController, macAndBox, putPolicy } from '../../../../fixtures/machines/power.ts';
import { agentOf, finish, runScene, stepStateIs } from '../../../../fixtures/runs.ts';
import { act, makeTask, moved, stepOf } from '../../../../fixtures/tasks.ts';

/** A step whose agent's machine is stopped: started for the work and waited for, or the task blocked in words. */

let w: BoxWorld;
beforeAll(async () => {
  w = await boxWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  while (w.waits.pending().length > 0) await w.waits.fire();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

/** The runs' team with its Developer moved to a stopped devbox that This Mac powers with `policy`. */
async function onBox(policy: MachinePowerPolicyInput) {
  const s = await runScene(w);
  const { mac, box } = await macAndBox(w, s.c);
  const driver = boxDriver();
  await connectController(w, mac.runnerKey, driver);
  await putPolicy(w, s.c, box.machineId, policy);
  await place(w, s.c, (await agentOf(w.t.db, s.c.developer)).id, { machineId: box.machineId });
  const develop = () =>
    makeTask(w, s.c, s.c.owner, { flowId: s.flow.id, stepId: stepOf(s.flow, 'Develop').id });
  return { ...s, box, driver, develop };
}

describe('a step whose agent’s machine is stopped', () => {
  it('starts the box with its start on work on, keeps the step working, and runs the turn once it connects', async () => {
    const s = await onBox({ autoStartOnWork: true });
    const task = await s.develop();
    expect(task).toMatchObject({
      stepState: 'working',
      blockedReason: null,
      conversations: [{ lastTurn: { status: 'queued', waitsForMachine: true } }],
    });
    expect(await logged(w, s.box.machineId, 'started')).toContain(
      `started auto: Started for ${task.key} · Develop`,
    );
    const box = await boxUp(w, s);
    finish(box, await box.frames.next('turn.start'), 'Built it.');
    await stepStateIs(w.t.db, task.id, 'ended_without_handoff');
  });

  it('blocks the task in words with its start on work off, and when the start fails', async () => {
    const off = await onBox({});
    const blocked = await off.develop();
    expect(blocked).toMatchObject({
      stepState: 'blocked',
      blockedReason: 'Airia devbox is stopped: start it on the Machines page, then retry',
    });
    const failing = await onBox({ autoStartOnWork: true });
    failing.driver.failNext('start', 'stockout_or_quota');
    const task = await failing.develop();
    const row = await stepStateIs(w.t.db, task.id, 'blocked');
    expect(row.blockedReason).toBe(
      `Airia devbox did not start: ${MACHINE_POWER_ERROR_MESSAGES.stockout_or_quota}`,
    );
  });

  it('counts a turn waiting for its machine as running: a move needs force, which stops it', async () => {
    const s = await onBox({ autoStartOnWork: true });
    const task = await s.develop();
    const res = await act(w, s.c, s.c.manager, task.key, { action: 'cancel', reason: 'Not now' });
    expect(res.status).toBe(409);
    const done = await moved(w, s.c, s.c.manager, task.key, {
      action: 'cancel',
      reason: 'Not now',
      force: true,
    });
    expect(done.task).toMatchObject({ state: 'cancelled' });
    expect(done.task.conversations[0]?.lastTurn).toMatchObject({ status: 'stopped', waitsForMachine: false });
  });
});
