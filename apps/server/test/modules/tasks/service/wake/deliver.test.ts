import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { beginChat, place } from '../../../../fixtures/chats/world.ts';
import {
  boxDriver,
  connectController,
  eventsOf,
  macAndBox,
  putPolicy,
} from '../../../../fixtures/machines/power.ts';
import { as } from '../../../../fixtures/members/members.ts';
import { agentOf, stepStateIs } from '../../../../fixtures/runs.ts';
import { flowsPath, moved, stepOf } from '../../../../fixtures/tasks.ts';
import {
  escalate,
  noticesOf,
  runDevelop,
  taskAt,
  teamChatsOf,
  tickPastWindow,
  turnsOf,
  type WakeWorld,
  wakeEvents,
  wakeScene,
  wakeWorld,
} from '../../../../fixtures/wakes.ts';

/**
 * A flow's Lead agent wakes up by itself (S6c, docs/processes.md "Built: the Lead wakes up"): a task's escalation, block
 * or turn ended without a hand-off (and a done task, when asked) is told in the Lead's team chat, as one turn Most Wanted
 * queues once the quiet window passed; a person Lead is never woken, and an event whose task moved on is let go.
 */

let w: WakeWorld;
beforeAll(async () => {
  w = await wakeWorld();
});
afterEach(() => w.disconnectAll());
afterAll(() => w.close());

describe('the Lead wakes up on its team’s events', () => {
  it('tells an escalation in its team chat, made on first use, as Most Wanted’s turn, not in a person’s chat', async () => {
    const s = await wakeScene(w);
    const lead = await agentOf(w.t.db, s.c.lead);
    const adHoc = await beginChat(w, s.c, lead.id);
    const task = await taskAt(w, s, 'QA');
    await escalate(w, s, task.key);
    const [event] = await wakeEvents(w.t.db, s.flow.id);
    expect(event).toMatchObject({ kind: 'escalated', stepName: 'QA', outcome: 'pending', taskId: task.id });
    expect(event?.reason).toContain('Still failing on Safari');

    await w.ticks.fire();
    expect(await teamChatsOf(w.t.db, s.flow.id)).toEqual([]);
    w.clock.advance(60_000);
    await w.ticks.fire();

    const start = await s.runner.frames.next('turn.start');
    expect(start.spec.prompt).toContain('Most Wanted · DEVBOX delivery: 1 task needs your decision.');
    expect(start.spec.prompt).toContain(`- ${task.key} “Fix the login” was escalated to you from QA: `);
    expect(start.spec.prompt).toContain('Decide: task_retry / task_route / task_cancel, or ask ');
    expect(start.spec.tools).toContain('team_board');
    const [team, ...more] = await teamChatsOf(w.t.db, s.flow.id);
    expect(more).toEqual([]);
    expect(team).toMatchObject({ agentId: lead.id, title: 'DEVBOX delivery: team', createdBy: s.c.lead });
    expect(team?.id).not.toBe(adHoc.id);
    const [turn] = await turnsOf(w.t.db, team?.id as string);
    expect(turn).toMatchObject({ system: true, createdBy: s.c.lead, status: 'running', delivery: null });
    expect(turn?.id).toBe(start.turnId);
    expect(await turnsOf(w.t.db, adHoc.id)).toEqual([]);
    const [told] = await wakeEvents(w.t.db, s.flow.id);
    expect(told).toMatchObject({ outcome: 'woke', chatId: team?.id, turnId: start.turnId });
    expect(await noticesOf(w.t.db, s.c.manager.principalId, 'lead_not_woken')).toEqual([]);

    const res = await as(w, s.c.owner)('GET', `/api/companies/${s.c.companyId}/chats/${team?.id}`);
    expect(res.body).toMatchObject({ flowId: s.flow.id, turns: [{ system: true }] });
    const board = await as(w, s.c.owner)('GET', flowsPath(s.c, `/${s.flow.id}/board`));
    const escalated = (
      board.body as { columns: { kind: string; cards: { leadNotifiedAt: string | null }[] }[] }
    ).columns.find((column) => column.kind === 'escalated');
    expect(escalated?.cards[0]?.leadNotifiedAt).toBe(w.clock().toISOString());
    const wakes = await as(w, s.c.viewer)('GET', flowsPath(s.c, `/${s.flow.id}/lead-wakes`));
    expect(wakes.body).toMatchObject({
      chat: { id: team?.id, agentId: lead.id },
      last: { outcome: 'woke', at: w.clock().toISOString(), detail: null },
      counts: { hour: 1, day: 1, pending: 0 },
    });
  });

  it('tells a block and an ended turn of one window in one message', async () => {
    const s = await wakeScene(w);
    const blocked = await taskAt(w, s, 'Develop', 'Add SSO');
    await runDevelop(w, s, blocked.key, 'failed');
    await stepStateIs(w.t.db, blocked.id, 'blocked');
    const ended = await taskAt(w, s, 'Develop', 'Write the docs');
    await runDevelop(w, s, ended.key, 'done');
    await stepStateIs(w.t.db, ended.id, 'ended_without_handoff');
    await tickPastWindow(w);

    const start = await s.runner.frames.next('turn.start');
    expect(start.spec.prompt).toContain('2 tasks need your decision');
    expect(start.spec.prompt).toContain(
      `- ${blocked.key} “Add SSO” is blocked at Develop: The repo is missing`,
    );
    expect(start.spec.prompt).toContain(
      `- ${ended.key} “Write the docs”: its turn ended at Develop without a hand-off`,
    );
    const events = await wakeEvents(w.t.db, s.flow.id);
    expect(events.map((e) => [e.kind, e.outcome, e.turnId])).toEqual([
      ['blocked', 'woke', start.turnId],
      ['turn_ended', 'woke', start.turnId],
    ]);
  });

  it('tells done tasks only when the flow asks, as a digest', async () => {
    const s = await wakeScene(w);
    const first = await taskAt(w, s, 'Approve', 'Ship it');
    await moved(w, s.c, s.c.owner, first.key, { action: 'approve' });
    expect(await wakeEvents(w.t.db, s.flow.id)).toEqual([]);
    const settings = {
      escalated: true,
      blocked: true,
      turnEnded: true,
      done: true,
      signoffHours: null,
      windowSeconds: 0,
      maxPerHour: 6,
      maxPerDay: 40,
      checkInMinutes: null,
    };
    const put = await as(w, s.c.owner)('PUT', flowsPath(s.c, `/${s.flow.id}/lead-wakes`), settings);
    expect(put.status).toBe(200);
    const second = await taskAt(w, s, 'Approve', 'Ship the docs');
    await moved(w, s.c, s.c.owner, second.key, { action: 'approve' });
    await w.ticks.fire();
    const start = await s.runner.frames.next('turn.start');
    expect(start.spec.prompt).toContain('Most Wanted · DEVBOX delivery: 1 task is done.');
    expect(start.spec.prompt).toContain(`- Done: ${second.key} “Ship the docs”.`);
    expect(start.spec.prompt).not.toContain('Decide');
  });

  it('never wakes a person Lead', async () => {
    const s = await wakeScene(w);
    const body = {
      leadPrincipalId: s.c.manager.principalId,
      name: 'Manager flow',
      steps: [
        { name: 'Build', kind: 'work', assigneePrincipalId: s.c.developer },
        {
          name: 'Check',
          kind: 'check',
          assigneePrincipalId: s.c.tester.principalId,
          sendsBackTo: 'Build',
          sendBackLimit: 1,
        },
      ],
    };
    const made = await as(w, s.c.owner)('POST', flowsPath(s.c), body);
    const flow = made.body as { id: string; steps: { id: string; name: string }[] };
    const res = await as(w, s.c.owner)('POST', `/api/companies/${s.c.companyId}/tasks`, {
      flowId: flow.id,
      title: 'People only',
      stepId: stepOf(flow as never, 'Check').id,
    });
    const key = (res.body as { key: string }).key;
    await moved(w, s.c, s.c.tester, key, { action: 'send_back', reason: 'No' });
    await moved(w, s.c, s.c.owner, key, { action: 'hand_on' });
    await moved(w, s.c, s.c.tester, key, { action: 'send_back', reason: 'Still no' });
    expect(await wakeEvents(w.t.db, flow.id)).toEqual([]);
    expect((await noticesOf(w.t.db, s.c.manager.principalId, 'task_escalated')).length).toBe(1);
  });

  it('lets go of an event whose task moved on within the window', async () => {
    const s = await wakeScene(w);
    const task = await taskAt(w, s, 'Develop');
    await runDevelop(w, s, task.key, 'failed');
    await stepStateIs(w.t.db, task.id, 'blocked');
    await w.ticks.fire();
    await moved(w, s.c, s.c.owner, task.key, { action: 'cancel', reason: 'Not needed' });
    w.clock.advance(60_000);
    await w.ticks.fire();
    const [event] = await wakeEvents(w.t.db, s.flow.id);
    expect(event).toMatchObject({ outcome: 'dropped', detail: 'The task moved on first', turnId: null });
    expect(await teamChatsOf(w.t.db, s.flow.id)).toEqual([]);
  });

  it('starts the Lead’s stopped machine for its wake-up, which waits for it and takes in the next one', async () => {
    const s = await wakeScene(w);
    const { mac, box } = await macAndBox(w, s.c);
    await connectController(w, mac.runnerKey, boxDriver());
    await putPolicy(w, s.c, box.machineId, { autoStartOnWork: true });
    await place(w, s.c, (await agentOf(w.t.db, s.c.lead)).id, { machineId: box.machineId });
    await escalate(w, s, (await taskAt(w, s, 'QA')).key);
    await tickPastWindow(w);
    const [team] = await teamChatsOf(w.t.db, s.flow.id);
    const [waiting] = await turnsOf(w.t.db, team?.id as string);
    expect(waiting).toMatchObject({ system: true, status: 'queued', delivery: 'after' });
    expect(waiting?.machineWaitAt).not.toBeNull();
    expect(await eventsOf(w.t.db, box.machineId)).toContain(
      'held auto: Held for 45 minutes after the last turn',
    );
    await escalate(w, s, (await taskAt(w, s, 'QA', 'Fix the logout')).key);
    await tickPastWindow(w);
    const turns = await turnsOf(w.t.db, team?.id as string);
    expect(turns).toHaveLength(1);
    expect(turns[0]?.prompt).toContain('Fix the logout');
  });
});
