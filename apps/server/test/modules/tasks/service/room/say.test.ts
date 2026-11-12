import { ROOM_ASK } from '@mwc/shared/flows';
import type { TurnStart } from '@mwc/shared/runner-protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ended, place } from '../../../../fixtures/chats/world.ts';
import { boxDriver, connectController, macAndBox, putPolicy } from '../../../../fixtures/machines/power.ts';
import { as } from '../../../../fixtures/members/members.ts';
import {
  roomChatOf,
  roomLines,
  roomOf,
  roomPath,
  roomRows,
  said,
  startsByAgent,
} from '../../../../fixtures/room.ts';
import { agentOf, finish } from '../../../../fixtures/runs.ts';
import { turnsOf, type WakeWorld, wakeScene, wakeWorld } from '../../../../fixtures/wakes.ts';

/**
 * A person writes in the team room (docs/processes.md "The team room"; Ihor's choice: "everyone may chime in"): the
 * message is stored and every agent of the team (or those it names with "@") gets a turn in its own room conversation,
 * Most Wanted's, naming the message; a reply goes into the room under the agent's face, a silent one posts nothing, and
 * nothing an agent posts asks anyone. Past the room's cap nobody is asked; a stopped machine is started only when its
 * policy starts it for a message.
 */

let w: WakeWorld;
beforeAll(async () => {
  w = await wakeWorld();
});
afterEach(() => w.disconnectAll());
afterAll(() => w.close());

const get = (starts: Map<string, TurnStart>, principal: string) => starts.get(principal) as TurnStart;

describe('a person’s message in the team room', () => {
  it('asks every agent in its own room conversation; replies go into the room, silence posts nothing', async () => {
    const s = await wakeScene(w);
    const room = await said(w, s, s.c.owner, 'Should we ship T-2 today?');
    const [message] = room.messages;
    expect(message).toMatchObject({ kind: 'message', body: 'Should we ship T-2 today?', to: [], asked: 2 });
    const starts = await startsByAgent(w, s, 2);
    const lead = get(starts, s.c.lead);
    const developer = get(starts, s.c.developer);
    expect(lead.spec.prompt).toContain("Most Wanted · DEVBOX delivery team room. You are DEVBOX Coordinator, the team's Lead.");
    expect(lead.spec.prompt).toContain('wrote:\nShould we ship T-2 today?');
    expect(lead.spec.prompt.endsWith(ROOM_ASK)).toBe(true);
    expect(lead.spec.tools).toContain('team_board');
    expect(developer.spec.prompt).toContain('team room. You are Developer.\nAgents: DEVBOX Coordinator, Developer;');
    expect(developer.spec.tools).toBeUndefined();
    const leadChat = await roomChatOf(w.t.db, s.flow.id, s.c.lead);
    const devChat = await roomChatOf(w.t.db, s.flow.id, s.c.developer);
    expect(devChat).toMatchObject({ title: 'DEVBOX delivery: team', createdBy: s.c.developer });
    const [devTurn] = await turnsOf(w.t.db, devChat?.id as string);
    expect(devTurn).toMatchObject({ system: true, createdBy: s.c.developer, roomMessageId: message?.id });

    finish(s.runner, lead, 'Not yet: QA has not passed it.');
    finish(s.runner, developer, 'NOTHING_TO_ADD');
    await ended(w.t.db, lead.turnId);
    await ended(w.t.db, developer.turnId);
    expect(await roomLines(w.t.db, s.flow.id)).toEqual([
      ['message', s.c.owner.principalId, 'Should we ship T-2 today?'],
      ['reply', s.c.lead, 'Not yet: QA has not passed it.'],
    ]);
    const reply = (await roomRows(w.t.db, s.flow.id))[1];
    expect(reply).toMatchObject({ chatId: leadChat?.id, turnId: lead.turnId, details: { replyTo: message?.id } });
    expect((await turnsOf(w.t.db, devChat?.id as string))[0]?.resultText).toBe('NOTHING_TO_ADD');
    // No loop: the reply asked nobody.
    expect(await turnsOf(w.t.db, leadChat?.id as string)).toHaveLength(1);
    expect(await turnsOf(w.t.db, devChat?.id as string)).toHaveLength(1);
    const view = await roomOf(w, s, s.c.viewer);
    expect(view.messages.map((m) => m.author?.name)).toEqual([expect.any(String), 'DEVBOX Coordinator']);
    expect(view.replying).toEqual([]);
  });

  it('asks only the agents an "@" names, and quotes what came since each one’s last turn there', async () => {
    const s = await wakeScene(w);
    const room = await said(w, s, s.c.owner, '@developer is the branch pushed?');
    expect(room.messages[0]).toMatchObject({ to: [s.c.developer], asked: 1 });
    expect(room.replying).toEqual([{ principalId: s.c.developer, status: 'running', machineWait: null }]);
    const first = get(await startsByAgent(w, s, 1), s.c.developer);
    expect(first.spec.prompt).not.toContain('Since your last turn here');
    finish(s.runner, first, 'Yes, pushed to t-2-login.');
    await ended(w.t.db, first.turnId);

    await said(w, s, s.c.manager, 'Thanks. @DEVBOX Coordinator, route it to QA.');
    const lead = get(await startsByAgent(w, s, 1), s.c.lead);
    expect(lead.spec.prompt).toContain('Since your last turn here:\n- ');
    expect(lead.spec.prompt).toContain(': @developer is the branch pushed?\n- Developer: Yes, pushed to t-2-login.');
    expect(lead.spec.prompt).toContain('wrote:\nThanks. @DEVBOX Coordinator, route it to QA.');
  });

  it('asks nobody past the room’s cap for the hour, and says so; the next hour asks again', async () => {
    const s = await wakeScene(w);
    const cap = await as(w, s.c.manager)('PUT', roomPath(s), { maxPerHour: 1 });
    expect(cap.status).toBe(200);
    const over = await said(w, s, s.c.owner, 'Status, everyone?');
    expect(over.messages.map((m) => [m.kind, m.body])).toEqual([
      ['message', 'Status, everyone?'],
      ['notice', 'Not asked: DEVBOX Coordinator, Developer. The room is at its 1 answers this hour.'],
    ]);
    expect(over.messages[0]?.asked).toBe(0);
    expect(await roomChatOf(w.t.db, s.flow.id, s.c.lead)).toBeUndefined();

    const one = await said(w, s, s.c.owner, '@Developer status?');
    expect(one.cap).toEqual({ maxPerHour: 1, askedLastHour: 1 });
    finish(s.runner, get(await startsByAgent(w, s, 1), s.c.developer), 'Testing.');
    const again = await said(w, s, s.c.owner, '@Developer and now?');
    expect(again.messages.at(-1)?.body).toBe('Not asked: Developer. The room is at its 1 answers this hour.');
    w.clock.advance(60 * 60_000 + 1);
    const later = await said(w, s, s.c.owner, '@Developer and now?');
    expect(later.messages.at(-1)).toMatchObject({ kind: 'message', asked: 1 });
  });

  it('does not start a stopped machine for room chatter unless its policy starts it for a message', async () => {
    const s = await wakeScene(w);
    const { mac, box } = await macAndBox(w, s.c);
    await connectController(w, mac.runnerKey, boxDriver());
    await putPolicy(w, s.c, box.machineId, { autoStartOnWork: true, autoStartOnMessage: false });
    await place(w, s.c, (await agentOf(w.t.db, s.c.developer)).id, { machineId: box.machineId });
    const room = await said(w, s, s.c.owner, 'Anyone around?');
    expect(room.messages.map((m) => [m.kind, m.body, m.asked])).toEqual([
      ['message', 'Anyone around?', 1],
      ['notice', 'Developer was not asked: Airia devbox is stopped', null],
    ]);
    finish(s.runner, get(await startsByAgent(w, s, 1), s.c.lead), 'I am.');

    await putPolicy(w, s.c, box.machineId, { autoStartOnWork: true, autoStartOnMessage: true });
    await said(w, s, s.c.owner, '@Developer and you?');
    const devChat = await roomChatOf(w.t.db, s.flow.id, s.c.developer);
    const [waiting] = await turnsOf(w.t.db, devChat?.id as string);
    expect(waiting).toMatchObject({ status: 'queued', machineWait: 'stopped', system: true });
  });

  it('names a paused agent as not asked', async () => {
    const s = await wakeScene(w);
    const developer = await agentOf(w.t.db, s.c.developer);
    const paused = await as(w, s.c.owner)('PATCH', `/api/companies/${s.c.companyId}/agents/${developer.id}`, {
      status: 'paused',
    });
    expect(paused.status).toBe(200);
    const room = await said(w, s, s.c.owner, 'Hello team');
    expect(room.messages.at(-1)?.body).toBe('Developer was not asked: The agent is paused: resume it to wake it');
    expect(room.messages[0]?.asked).toBe(1);
  });
});
