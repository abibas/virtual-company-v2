import { TEST_NOW } from '@mwc/testkit';
import type { FakeRunner } from '@mwc/testkit/runner';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ChatTurnView } from '../../../../src/modules/chats/schemas.ts';
import { brief, type OpenActivity, openActivity } from '../../../fixtures/chats/activity.ts';
import { boxScene, boxUp } from '../../../fixtures/chats/machine.ts';
import {
  ANSWER,
  beginChat,
  type ChatsWorld,
  chatPath,
  chatsWorld,
  endTurn,
  type Scene,
  scene,
  sendEvents,
  startedTurn,
} from '../../../fixtures/chats/world.ts';
import { addMember, as } from '../../../fixtures/members/members.ts';
import type { Person } from '../../../fixtures/platform/auth.ts';
import { manualTimers } from '../../../fixtures/platform/jobs.ts';

/**
 * `GET …/chat-activity` (2026-11-13, docs/harness.md "Live chat lists"): the company's chats live, each `chat` message
 * the chat as it is now with its latest turn, for a chat begun, renamed or archived and each turn that is queued,
 * starts or ends; members and above, and only their own company's chats.
 */

let w: ChatsWorld;
const waits = manualTimers();
const open: OpenActivity[] = [];
beforeAll(async () => {
  w = await chatsWorld({}, { machineWaitTimers: waits.timers });
});
afterEach(async () => {
  for (const stream of open.splice(0)) await stream.close();
  await w.disconnectAll();
  while (waits.pending().length > 0) await waits.fire();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

async function listen(s: Pick<Scene, 'company'>, person: Person = s.company.owner) {
  const stream = await openActivity(w.t.app, s.company.companyId, person);
  open.push(stream);
  return stream;
}

const runner = (s: Scene) => s.runner as FakeRunner;

describe('GET chat-activity', () => {
  it('tells a chat begun, then its turn as it starts and ends, with the title its first prompt gave', async () => {
    const s = await scene(w);
    const live = await listen(s);
    expect([live.status, live.contentType]).toEqual([200, 'text/event-stream']);
    const chat = await beginChat(w, s.company, s.agentId);
    const begun = await live.next('the new chat', (v) => v.chat.id === chat.id);
    expect(begun).toEqual({ chat, lastTurn: null });
    const start = await startedTurn(w, { ...s, chat });
    const running = await live.next('its turn running', (v) => v.lastTurn?.status === 'running');
    expect(running.chat.title).toBe('What is 2 + 2?');
    expect(running.lastTurn).toMatchObject({ id: start.turnId, system: false, from: null });
    sendEvents(runner(s), start.turnId, ANSWER);
    endTurn(runner(s), start.turnId);
    const done = await live.next('its end', (v) => v.lastTurn?.status === 'done');
    expect(done.lastTurn?.resultText).toBe('4');
    // The answer's events tell nothing: only the turn's start and end.
    expect(live.chats().map(brief)).toEqual([
      '-: none',
      'What is 2 + 2?: running',
      'What is 2 + 2?: done',
    ]);
    expect(live.messages[0]?.comment).toBe('open');
  });

  it('tells a chat renamed and one archived', async () => {
    const s = await scene(w);
    const live = await listen(s);
    const owner = as(w, s.company.owner);
    expect((await owner('PATCH', chatPath(s.company, s.chat.id), { title: 'Plans' })).status).toBe(200);
    await live.next('the new title', (v) => v.chat.title === 'Plans');
    expect((await owner('DELETE', chatPath(s.company, s.chat.id))).status).toBe(204);
    const archived = await live.next('the archive', (v) => v.chat.archivedAt !== null);
    expect(archived.chat.id).toBe(s.chat.id);
  });

  it('tells a turn that waits for a free slot, then its start once a slot is free', async () => {
    const s = await scene(w, { caps: { slots: 1 } });
    const first = await startedTurn(w, s, 'First');
    const other = await beginChat(w, s.company, s.agentId);
    const live = await listen(s);
    const res = await as(w, s.company.owner)('POST', chatPath(s.company, other.id, '/turns'), { prompt: 'Second' });
    const second = res.body as ChatTurnView;
    expect(second).toMatchObject({ status: 'queued', machineWait: 'slots' });
    await live.next('the waiting turn', (v) => v.lastTurn?.id === second.id && v.lastTurn.status === 'queued');
    endTurn(runner(s), first.turnId);
    await live.next('its start', (v) => v.lastTurn?.id === second.id && v.lastTurn.status === 'running');
  });

  it('tells a turn that waits for its stopped machine, then its start once the machine’s runner connects', async () => {
    const s = await boxScene(w);
    const live = await listen(s);
    const res = await as(w, s.company.owner)('POST', chatPath(s.company, s.chat.id, '/turns'), {
      prompt: 'hi',
      startMachine: true,
    });
    const turn = res.body as ChatTurnView;
    const waiting = await live.next('the waiting turn', (v) => v.lastTurn?.id === turn.id);
    expect(waiting.lastTurn).toMatchObject({ status: 'queued', machineWait: 'stopped' });
    const box = await boxUp(w, s);
    await box.frames.next('turn.start');
    await live.next('its start', (v) => v.lastTurn?.id === turn.id && v.lastTurn.status === 'running');
  });

  it('is for members and above, and tells only their own company’s chats', async () => {
    const s = await scene(w);
    const member = await listen(s, await addMember(w, s.company, 'member'));
    expect(member.status).toBe(200);
    const viewer = await listen(s, await addMember(w, s.company, 'viewer'));
    expect(viewer.status).toBe(403);
    const elsewhere = await scene(w);
    const theirs = await listen(elsewhere);
    const chat = await beginChat(w, s.company, s.agentId);
    await member.next('the new chat', (v) => v.chat.id === chat.id);
    const own = await beginChat(w, elsewhere.company, elsewhere.agentId);
    await theirs.next('their own chat', (v) => v.chat.id === own.id);
    expect(theirs.chats().map((v) => v.chat.id)).toEqual([own.id]);
    expect(member.chats().map((v) => v.chat.id)).toEqual([chat.id]);
  });
});
