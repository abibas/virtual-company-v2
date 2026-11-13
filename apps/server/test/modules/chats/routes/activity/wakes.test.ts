import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type OpenActivity, openActivity } from '../../../../fixtures/chats/activity.ts';
import { said, startsByAgent } from '../../../../fixtures/room.ts';
import { agentOf, finish, stepStateIs } from '../../../../fixtures/runs.ts';
import {
  runDevelop,
  taskAt,
  tickPastWindow,
  type WakeWorld,
  wakeScene,
  wakeWorld,
} from '../../../../fixtures/wakes.ts';

/**
 * Turns Most Wanted queues in a flow's team chats, live (2026-11-13, docs/harness.md "Live chat lists"): a Lead's
 * wake-up and the team room's turns show in the company's chats' activity with their chats, as Most Wanted's (no
 * `from`); a task's own conversation never does.
 */

let w: WakeWorld;
const open: OpenActivity[] = [];
beforeAll(async () => {
  w = await wakeWorld();
});
afterEach(async () => {
  for (const stream of open.splice(0)) await stream.close();
  await w.disconnectAll();
});
afterAll(() => w.close());

describe('turns Most Wanted queues', () => {
  it('shows a Lead’s wake-up in its team chat, never the task’s own conversation', async () => {
    const s = await wakeScene(w);
    const live = await openActivity(w.t.app, s.c.companyId, s.c.owner);
    open.push(live);
    const task = await taskAt(w, s, 'Develop', 'One');
    await runDevelop(w, s, task.key, 'failed');
    await stepStateIs(w.t.db, task.id, 'blocked');
    await tickPastWindow(w);
    const start = await s.runner.frames.next('turn.start');
    const lead = await agentOf(w.t.db, s.c.lead);
    const woke = await live.next('the wake-up', (v) => v.lastTurn?.id === start.turnId);
    expect(woke.chat).toMatchObject({ agentId: lead.id, title: 'DEVBOX delivery: team', flowId: s.flow.id });
    expect(woke.lastTurn).toMatchObject({ status: 'running', system: true, from: null });
    expect(live.chats().every((v) => v.chat.task === null)).toBe(true);
    finish(s.runner, start, 'Looking.');
    await live.next('its end', (v) => v.lastTurn?.id === start.turnId && v.lastTurn.status === 'done');
  });

  it('shows each agent’s turn for a message in the team room', async () => {
    const s = await wakeScene(w);
    const live = await openActivity(w.t.app, s.c.companyId, s.c.owner);
    open.push(live);
    await said(w, s, s.c.owner, 'Should we ship T-2 today?');
    const starts = await startsByAgent(w, s, 2);
    for (const principal of [s.c.lead, s.c.developer]) {
      const agent = await agentOf(w.t.db, principal);
      const turnId = starts.get(principal)?.turnId;
      const shown = await live.next('its room turn', (v) => v.lastTurn?.id === turnId);
      expect(shown.chat.agentId).toBe(agent.id);
      expect(shown.lastTurn).toMatchObject({ status: 'running', system: true, from: null });
    }
    for (const start of starts.values()) finish(s.runner, start, 'NOTHING_TO_ADD');
    await live.next('both ends', () => live.chats().filter((v) => v.lastTurn?.status === 'done').length >= 2);
  });
});
