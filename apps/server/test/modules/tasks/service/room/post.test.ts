import { roomMessages, tasks } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { TEST_NOW } from '@mwc/testkit';
import { asc, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { RoomView } from '../../../../../src/modules/tasks/schemas/room.ts';
import { type ChatsWorld, chatsWorld } from '../../../../fixtures/chats/world.ts';
import { as } from '../../../../fixtures/members/members.ts';
import {
  endTurn,
  eventually,
  finish,
  type RunScene,
  stepStateIs,
  taskRow,
} from '../../../../fixtures/runs.ts';
import { flowsPath, makeTask, moved, stepOf } from '../../../../fixtures/tasks.ts';
import { toolCall, toolScene } from '../../../../fixtures/tools.ts';

/**
 * A step agent's line in the team room when its step ends (docs/processes.md "The team room"; Ihor's choice: "a line at
 * each step end"): handed on, passed, approved, sent back, escalated, blocked, or its turn ended without a move; under
 * the agent's face, made from its own words, linked to the task, in the move's transaction. A turn a person stopped, a
 * failed turn and a person's move by hand post nothing.
 */

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

/** A task made into `step`, and its turn as the runner got it. */
async function atStep(s: RunScene, step = 'Develop') {
  const task = await makeTask(w, s.c, s.c.owner, { flowId: s.flow.id, stepId: stepOf(s.flow, step).id });
  return { task, start: await s.runner.frames.next('turn.start') };
}

/** The flow's room lines as `[kind, author, body]`, oldest first. */
const lines = async (flowId: string) =>
  (
    await rawDb(w.t.db)
      .select()
      .from(roomMessages)
      .where(eq(roomMessages.flowId, flowId))
      .orderBy(asc(roomMessages.createdAt), asc(roomMessages.id))
  ).map((row) => [row.kind, row.authorPrincipalId, row.body] as const);

/** Waits until the flow's room holds `n` messages, and gives them. */
async function linesAre(flowId: string, n: number) {
  await eventually(`the room holds ${n}`, async () => (await lines(flowId)).length === n);
  return lines(flowId);
}

describe('a step agent’s line when its step ends', () => {
  it('says a hand-on with the agent’s summary, linked to the task, and shows its move in the feed', async () => {
    const s = await toolScene(w);
    const { task, start } = await atStep(s);
    await toolCall(s.runner, start.turnId, 'task_hand_on', {
      summary: 'three scripts and their logs,\noverlap shown',
    });
    finish(s.runner, start, 'Done.');
    const review = await s.runner.frames.next('turn.start');
    expect(await linesAre(s.flow.id, 1)).toEqual([
      [
        'step_end',
        s.c.developer,
        `${task.key} · Develop → Code review: three scripts and their logs, overlap shown`,
      ],
    ]);
    const room = (await as(w, s.c.viewer)('GET', flowsPath(s.c, `/${s.flow.id}/room`))).body as RoomView;
    expect(room.messages[0]).toMatchObject({
      author: { principalId: s.c.developer, kind: 'agent', name: 'Developer' },
      task: { id: task.id, key: task.key, title: 'Fix the login' },
      step: {
        action: 'hand_on',
        from: 'Develop',
        to: 'Code review',
        round: 1,
        words: 'three scripts and their logs, overlap shown',
      },
    });
    // A pass without findings takes the turn's reply; it wakes no one and starts no turn of its own.
    await toolCall(s.runner, review.turnId, 'task_pass', {});
    finish(s.runner, review, 'PASS\nNo findings.');
    expect((await linesAre(s.flow.id, 2))[1]).toEqual([
      'step_end',
      s.c.reviewer,
      `${task.key} · Code review passed → Approve: PASS No findings.`,
    ]);
  });

  it('says a send-back with its reason, and an escalation past the limit', async () => {
    const s = await toolScene(w);
    const { task, start } = await atStep(s, 'Code review');
    await toolCall(s.runner, start.turnId, 'task_send_back', {
      reason: 'Empty passwords pass',
      findings: 'line 12',
    });
    finish(s.runner, start, 'SEND BACK');
    const develop = await s.runner.frames.next('turn.start');
    expect((await linesAre(s.flow.id, 1))[0]?.[2]).toBe(
      `${task.key} · Code review sent back → Develop: Empty passwords pass`,
    );
    endTurn(s.runner, develop.turnId, { ok: false, exitCode: null, error: 'stopped' });
    await stepStateIs(w.t.db, task.id, 'ended_without_handoff');
    await moved(w, s.c, s.c.owner, task.key, { action: 'hand_on' });
    const again = await s.runner.frames.next('turn.start');
    const review = stepOf(s.flow, 'Code review').id;
    await rawDb(w.t.db)
      .update(tasks)
      .set({ rounds: { [review]: { entries: 4, sendBacks: 3 } } })
      .where(eq(tasks.id, task.id));
    await toolCall(s.runner, again.turnId, 'task_send_back', { reason: 'Still broken', findings: 'Same.' });
    finish(s.runner, again, 'SEND BACK');
    const all = await linesAre(s.flow.id, 2);
    expect(all[1]).toEqual([
      'step_end',
      s.c.reviewer,
      `${task.key} · Code review escalated → Lead: Still broken`,
    ]);
  });

  it('says an approval at the last step as done', async () => {
    const s = await toolScene(w);
    const steps = s.flow.steps.map((step) => ({
      id: step.id,
      name: step.name,
      kind: step.kind,
      assigneePrincipalId: step.name === 'Approve' ? s.c.reviewer : step.assignee.principalId,
      starts: 'auto',
      ...(step.kind === 'work' ? {} : { sendsBackTo: 'Develop' }),
    }));
    const put = await as(w, s.c.owner)('PUT', flowsPath(s.c, `/${s.flow.id}/steps`), { steps });
    expect(put.status).toBe(200);
    const { task, start } = await atStep(s, 'Approve');
    await toolCall(s.runner, start.turnId, 'task_approve', { note: 'Ship it.' });
    finish(s.runner, start, 'APPROVE');
    await eventually('the task is done', async () => (await taskRow(w.t.db, task.id)).state === 'done');
    expect(await linesAre(s.flow.id, 1)).toEqual([
      ['step_end', s.c.reviewer, `${task.key} · Approve approved → Done: Ship it.`],
    ]);
  });

  it('says a block with its reason, and a turn that ended without a move with its reply', async () => {
    const s = await toolScene(w);
    const blocked = await atStep(s);
    await toolCall(s.runner, blocked.start.turnId, 'task_blocked', { reason: 'No access to the repo' });
    finish(s.runner, blocked.start, 'I cannot reach it.');
    await stepStateIs(w.t.db, blocked.task.id, 'blocked');
    const ended = await atStep(s);
    finish(s.runner, ended.start, 'I looked at it.\nNothing to change yet.');
    await stepStateIs(w.t.db, ended.task.id, 'ended_without_handoff');
    expect(await linesAre(s.flow.id, 2)).toEqual([
      ['step_end', s.c.developer, `${blocked.task.key} · Develop · blocked: No access to the repo`],
      [
        'step_end',
        s.c.developer,
        `${ended.task.key} · Develop · no hand-off: I looked at it. Nothing to change yet.`,
      ],
    ]);
  });

  it('posts nothing for a turn a person stopped, a failed turn, or a person’s move by hand', async () => {
    const s = await toolScene(w);
    const { task, start } = await atStep(s);
    endTurn(s.runner, start.turnId, { ok: false, exitCode: null, error: 'stopped' });
    await stepStateIs(w.t.db, task.id, 'ended_without_handoff');
    await moved(w, s.c, s.c.owner, task.key, { action: 'start' });
    const failed = await s.runner.frames.next('turn.start');
    endTurn(s.runner, failed.turnId, { ok: false, exitCode: 1, error: 'spawn_failed: ENOENT' });
    await stepStateIs(w.t.db, task.id, 'blocked');
    await moved(w, s.c, s.c.owner, task.key, { action: 'hand_on' });
    await s.runner.frames.next('turn.start');
    expect(await lines(s.flow.id)).toEqual([]);
  });
});
