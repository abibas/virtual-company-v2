import type { TurnStart } from '@mwc/shared/runner-protocol';
import { TEST_NOW } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type BoxWorld, boxWorld } from '../../../../fixtures/chats/machine.ts';
import { beginChat, endTurn, sendPrompt } from '../../../../fixtures/chats/world.ts';
import { agentOf, finish, type RunScene, runScene, stepStateIs, taskRow } from '../../../../fixtures/runs.ts';
import { makeTask, stepOf } from '../../../../fixtures/tasks.ts';

/**
 * A step whose agent's machine has every slot taken (docs/harness.md "Waiting for a free slot"): the Lead's two turns
 * fill This Mac's two slots, as on 2026-11-12, and the Developer's turn waits for one with the task still working, never
 * blocked "busy"; a turn there ending starts it. After 30 minutes the task is blocked in words.
 */

let w: BoxWorld;
beforeAll(async () => {
  w = await boxWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

/** The runs' team on a machine of two slots, the Lead placed there too, with two turns of its own running. */
async function fullMachine(): Promise<{ s: RunScene; lead: [TurnStart, TurnStart] }> {
  const s = await runScene(w, { caps: { slots: 2, agentTools: true }, placeLead: true });
  const lead = await agentOf(w.t.db, s.c.lead);
  const turns: TurnStart[] = [];
  for (const text of ['Run a test task', 'And watch it']) {
    const chat = await beginChat(w, s.c, lead.id);
    expect((await sendPrompt(w, { company: s.c, chat }, text)).status).toBe(202);
    turns.push(await s.runner.frames.next('turn.start'));
  }
  return { s, lead: turns as [TurnStart, TurnStart] };
}

const develop = (s: RunScene, title: string) =>
  makeTask(w, s.c, s.c.owner, { flowId: s.flow.id, title, stepId: stepOf(s.flow, 'Develop').id });

describe('a step whose machine has every slot taken', () => {
  it('waits for a free slot with the task working, and runs when a turn there ends', async () => {
    const { s, lead } = await fullMachine();
    const task = await develop(s, 'Test task');
    expect(task).toMatchObject({
      stepState: 'working',
      blockedReason: null,
      conversations: [
        {
          machine: 'This Mac',
          lastTurn: { status: 'queued', waitsForMachine: true, machineWait: 'slots' },
        },
      ],
    });
    endTurn(s.runner, lead[0].turnId);
    const start = await s.runner.frames.next('turn.start');
    expect(start.spec.prompt).toContain('Develop');
    finish(s.runner, start, 'Built it.');
    await stepStateIs(w.t.db, task.id, 'ended_without_handoff');
  });

  it('blocks the task in words when no slot came within 30 minutes', async () => {
    const { s } = await fullMachine();
    const task = await develop(s, 'Never runs');
    while (w.waits.pending().length > 1) await w.waits.fire();
    w.clock.advance(30 * 60_000);
    await w.waits.fire();
    const row = await stepStateIs(w.t.db, task.id, 'blocked');
    expect(row.blockedReason).toBe('This Mac had no free slot for 30 minutes (2 of 2 in use)');
    expect((await taskRow(w.t.db, task.id))?.blockedReason).not.toContain('busy');
  });
});
