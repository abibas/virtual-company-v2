import { agents, tenant } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { CHAT_PROMPT, CHAT_TITLE } from '@mwc/shared/chats';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { QueueDeps } from '../../../../src/modules/chats/service/queue.ts';
import { teamChats, teamTitle } from '../../../../src/modules/chats/service/team.ts';
import { chatPath } from '../../../fixtures/chats/world.ts';
import { as } from '../../../fixtures/members/members.ts';
import { agentsPath } from '../../../fixtures/org.ts';
import { agentOf, stepStateIs } from '../../../fixtures/runs.ts';
import {
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
} from '../../../fixtures/wakes.ts';

/**
 * A flow's team chat (S6c): "<flow>: team", made on the Lead's first wake-up and gone on while it can; an archived one
 * gives way to a new one; a paused Lead is not woken (its nearest person is told once).
 */

let w: WakeWorld;
beforeAll(async () => {
  w = await wakeWorld();
});
afterEach(() => w.disconnectAll());
afterAll(() => w.close());

async function blocked(s: WakeScene, title: string) {
  const task = await taskAt(w, s, 'Develop', title);
  await runDevelop(w, s, task.key, 'failed');
  await stepStateIs(w.t.db, task.id, 'blocked');
}

describe('a flow’s team chat', () => {
  it('is titled after its flow, cut to a chat title’s length', () => {
    expect(teamTitle('DEVBOX delivery')).toBe('DEVBOX delivery: team');
    expect(teamTitle('  Two\n words ')).toBe('Two words: team');
    const long = teamTitle('x'.repeat(80));
    expect(long).toHaveLength(CHAT_TITLE.max);
    expect(long.endsWith('…: team')).toBe(true);
  });

  it('goes on in the same chat, and in a new one once it is archived', async () => {
    const s = await wakeScene(w);
    await blocked(s, 'One');
    await tickPastWindow(w);
    const first = await s.runner.frames.next('turn.start');
    const [team] = await teamChatsOf(w.t.db, s.flow.id);
    expect((await as(w, s.c.owner)('DELETE', chatPath(s.c, team?.id as string))).status).toBe(204);
    await blocked(s, 'Two');
    await tickPastWindow(w);
    const chats = await teamChatsOf(w.t.db, s.flow.id);
    expect(chats).toHaveLength(2);
    const [woke] = await turnsOf(w.t.db, chats[1]?.id as string);
    expect(woke?.system).toBe(true);
    expect(woke?.id).not.toBe(first.turnId);
  });

  it('queues a wake-up of its own when the waiting one has no room left for it', async () => {
    const s = await wakeScene(w);
    await blocked(s, 'One');
    await tickPastWindow(w);
    await s.runner.frames.next('turn.start');
    await blocked(s, 'Two');
    await tickPastWindow(w);
    const [team] = await teamChatsOf(w.t.db, s.flow.id);
    const chatId = team?.id as string;
    const [, waiting] = await turnsOf(w.t.db, chatId);
    const full = 'x'.repeat(CHAT_PROMPT.max - 10);
    const edit = await as(w, s.c.owner)('PATCH', chatPath(s.c, chatId, `/turns/${waiting?.id}`), {
      prompt: full,
    });
    expect(edit.status).toBe(200);
    await blocked(s, 'Three');
    await tickPastWindow(w);
    const turns = await turnsOf(w.t.db, chatId);
    expect(turns.map((turn) => [turn.status, turn.system])).toEqual([
      ['running', true],
      ['queued', true],
      ['queued', true],
    ]);
    expect(turns[1]?.prompt).toBe(full);
    expect(turns[2]?.prompt).toContain('“Three”');
  });

  it('refuses an agent it cannot find, and an archived one', async () => {
    const s = await wakeScene(w);
    const t = await tenant(w.t.db, s.c.companyId);
    const wake = (agentPrincipalId: string) =>
      teamChats({} as QueueDeps).wake(t, {
        flowId: s.flow.id,
        flowName: 'F',
        agentPrincipalId,
        prompt: 'Hi',
      });
    expect(await wake('019a4f0c-0000-7000-8000-000000000000')).toMatchObject({ code: 'agent_not_found' });
    await rawDb(w.t.db).update(agents).set({ status: 'archived' }).where(eq(agents.principalId, s.c.lead));
    expect(await wake(s.c.lead)).toMatchObject({ code: 'agent_archived' });
  });

  it('does not wake a paused Lead, and says so to its nearest person once', async () => {
    const s = await wakeScene(w);
    const lead = await agentOf(w.t.db, s.c.lead);
    expect((await as(w, s.c.owner)('PATCH', agentsPath(s.c, lead.id), { status: 'paused' })).status).toBe(
      200,
    );
    await blocked(s, 'One');
    await tickPastWindow(w);
    const [event] = await wakeEvents(w.t.db, s.flow.id);
    expect(event).toMatchObject({
      outcome: 'unreachable',
      detail: 'The agent is paused: resume it to wake it',
    });
    expect(await teamChatsOf(w.t.db, s.flow.id)).toEqual([]);
    const notices = await noticesOf(w.t.db, s.c.manager.principalId, 'lead_not_woken');
    expect(notices).toHaveLength(1);
  });
});
