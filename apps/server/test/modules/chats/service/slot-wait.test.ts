import { type Chat, type ChatTurn, chats, tenant } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { TEST_NOW } from '@mwc/testkit';
import type { FakeRunner } from '@mwc/testkit/runner';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ChatTurnView } from '../../../../src/modules/chats/schemas.ts';
import type { ChatsLive } from '../../../../src/modules/chats/service/live.ts';
import type { MachineWaits } from '../../../../src/modules/chats/service/machine-wait.ts';
import { slotsOf, slotWaits, waitForSlot } from '../../../../src/modules/chats/service/slot-wait.ts';
import type { RunnerHub } from '../../../../src/modules/machines/index.ts';
import { queued } from '../../../fixtures/chats/queue.ts';
import {
  beginChat,
  type ChatsWorld,
  chatPath,
  chatRow,
  chatsWorld,
  ended,
  endTurn,
  eventually,
  type Scene,
  scene,
  turnRow,
} from '../../../fixtures/chats/world.ts';
import { as } from '../../../fixtures/members/members.ts';
import { type ManualTimers, manualTimers } from '../../../fixtures/platform/jobs.ts';

/**
 * A turn for a machine with every slot taken (docs/harness.md "Waiting for a free slot"): it waits `queued` for a free
 * slot instead of the runner's `busy`, and starts when a turn on that machine ends, the chat waiting longest first; a
 * turn the runner still refuses for a full machine waits the same way; the wait runs out after 30 minutes in words; a
 * Compact is refused; the person can stop it.
 */

let w: ChatsWorld;
let waits: ManualTimers;
beforeAll(async () => {
  waits = manualTimers();
  w = await chatsWorld({}, { machineWaitTimers: waits.timers });
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

const runner = (s: Scene) => s.runner as FakeRunner;
const prompt = (s: Scene, chatId: string, text: string) =>
  as(w, s.company.owner)('POST', chatPath(s.company, chatId, '/turns'), { prompt: text });

/** Another chat with the scene's agent. */
const otherChat = (s: Scene) => beginChat(w, s.company, s.agentId);

/** Sends a prompt that waits for a free slot; its turn. */
async function waiting(s: Scene, chatId: string, text: string): Promise<ChatTurnView> {
  const res = await prompt(s, chatId, text);
  expect(res.status).toBe(202);
  const turn = res.body as ChatTurnView;
  expect(turn).toMatchObject({ status: 'queued', delivery: 'after', machineWait: 'slots' });
  return turn;
}

describe('a turn waits for a free slot', () => {
  it('while every slot is taken, then starts when a turn on the machine ends, the longest waiting first', async () => {
    const s = await scene(w, { caps: { slots: 1 } });
    const res = await prompt(s, s.chat.id, 'First');
    const first = await runner(s).frames.next('turn.start');
    expect(first.turnId).toBe((res.body as ChatTurnView).id);
    const b = await otherChat(s);
    const c = await otherChat(s);
    const second = await waiting(s, b.id, 'Second');
    w.clock.advance(1_000);
    const third = await waiting(s, c.id, 'Third');
    expect((await turnRow(w.t.db, second.id))?.machineWaitAt).toEqual(new Date(TEST_NOW));

    endTurn(runner(s), first.turnId);
    expect((await runner(s).frames.next('turn.start')).turnId).toBe(second.id);
    expect(await turnRow(w.t.db, third.id)).toMatchObject({ status: 'queued', machineWait: 'slots' });
    endTurn(runner(s), second.id);
    expect((await runner(s).frames.next('turn.start')).turnId).toBe(third.id);
  });

  it('lets a new message of a free chat wait behind the chats that waited first', async () => {
    const s = await scene(w, { caps: { slots: 2 } });
    await prompt(s, s.chat.id, 'One');
    const one = await runner(s).frames.next('turn.start');
    const b = await otherChat(s);
    await prompt(s, b.id, 'Two');
    await runner(s).frames.next('turn.start');
    const c = await otherChat(s);
    const waited = await waiting(s, c.id, 'Three');
    endTurn(runner(s), one.turnId);
    expect((await runner(s).frames.next('turn.start')).turnId).toBe(waited.id);
    const d = await otherChat(s);
    await waiting(s, d.id, 'Four');
  });

  it('holds a chat’s next message behind the chats that waited longer, keeping its wait', async () => {
    const s = await scene(w, { caps: { slots: 1 } });
    await prompt(s, s.chat.id, 'First');
    const first = await runner(s).frames.next('turn.start');
    const later = await queued(w, s, 'Later');
    expect(later.machineWait).toBeNull();
    const b = await otherChat(s);
    const second = await waiting(s, b.id, 'Second');
    w.clock.advance(1_000);
    endTurn(runner(s), first.turnId);
    expect((await runner(s).frames.next('turn.start')).turnId).toBe(second.id);
    const held = await turnRow(w.t.db, later.id);
    expect(held).toMatchObject({ status: 'queued', machineWait: 'slots' });
    w.clock.advance(1_000);
    await queued(w, s, 'Even later');
    expect((await turnRow(w.t.db, later.id))?.machineWaitAt).toEqual(held?.machineWaitAt);
    endTurn(runner(s), second.id);
    expect((await runner(s).frames.next('turn.start')).turnId).toBe(later.id);
  });

  it('waits again when the runner says every slot is taken, starts when a turn there ends, keeping its wait', async () => {
    const s = await scene(w);
    await prompt(s, s.chat.id, 'Busy one');
    const refused = await runner(s).frames.next('turn.start');
    endTurn(runner(s), refused.turnId, { ok: false, exitCode: null, error: 'busy' });
    await eventually(
      'it waits for a slot',
      async () => (await turnRow(w.t.db, refused.turnId))?.status === 'queued',
    );
    expect(await turnRow(w.t.db, refused.turnId)).toMatchObject({
      delivery: 'after',
      machineWait: 'slots',
      startedAt: null,
      error: null,
    });
    const since = (await turnRow(w.t.db, refused.turnId))?.machineWaitAt;
    const b = await otherChat(s);
    await prompt(s, b.id, 'Other');
    const other = await runner(s).frames.next('turn.start');
    w.clock.advance(60_000);
    endTurn(runner(s), other.turnId);
    expect((await runner(s).frames.next('turn.start')).turnId).toBe(refused.turnId);
    endTurn(runner(s), refused.turnId, { ok: false, exitCode: null, error: 'busy' });
    await eventually(
      'it waits again',
      async () => (await turnRow(w.t.db, refused.turnId))?.status === 'queued',
    );
    expect((await turnRow(w.t.db, refused.turnId))?.machineWaitAt).toEqual(since);
  });

  it('fails after 30 minutes in words, refuses a Compact, and stops when the person says so', async () => {
    const s = await scene(w, { caps: { slots: 1 } });
    await prompt(s, s.chat.id, 'Long one');
    await runner(s).frames.next('turn.start');
    const b = await otherChat(s);
    await rawDb(w.t.db).update(chats).set({ sessionId: 'b4c1f0e2-session' }).where(eq(chats.id, b.id));
    const compact = await as(w, s.company.owner)('POST', chatPath(s.company, b.id, '/compact'));
    expect(compact.status).toBe(409);
    expect(compact.body).toMatchObject({
      error: { code: 'machine_busy', message: expect.stringContaining('has no free slot (1 of 1 in use)') },
    });
    const turn = await waiting(s, b.id, 'Waits');
    while (waits.pending().length > 1) await waits.fire();
    expect(waits.pending()).toEqual([30 * 60_000]);
    w.clock.advance(30 * 60_000);
    await waits.fire();
    expect(await ended(w.t.db, turn.id)).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/ had no free slot for 30 minutes \(1 of 1 in use\)$/),
    });

    const c = await otherChat(s);
    const stopped = await waiting(s, c.id, 'Stop me');
    const stop = await as(w, s.company.owner)('POST', chatPath(s.company, c.id, `/turns/${stopped.id}/stop`));
    expect(stop.status).toBe(202);
    expect(await turnRow(w.t.db, stopped.id)).toMatchObject({ status: 'stopped' });
  });
});

describe('the slots’ edges', () => {
  it('logs what it could not do, and waits on a machine with nothing to start', async () => {
    const s = await scene(w, { caps: { slots: 1 } });
    const t = await tenant(w.t.db, s.company.companyId);
    const watched: string[] = [];
    const fakeWaits = {
      watch: (_t: unknown, chatId: string) => watched.push(chatId),
    } as unknown as MachineWaits;
    const slots = slotWaits({
      hub: w.hub,
      logger: w.deps.logger,
      waits: fakeWaits,
      startNext: async () => undefined,
    });
    const nobody = '019a0000-0000-7000-8000-000000000000';
    await slots.freed(t, nobody);
    await slots.held(t, { id: nobody, chatId: nobody } as ChatTurn);
    expect(
      w.logs.filter((line) => line.msg === 'chats: could not watch a turn that waits for a slot'),
    ).toHaveLength(1);
    await slots.held(t, { id: nobody, chatId: s.chat.id } as ChatTurn);
    expect(watched).toEqual([s.chat.id]);

    const live = { bus: { publish: () => undefined } } as unknown as ChatsLive;
    const chat = (await chatRow(w.t.db, s.chat.id)) as Chat;
    const machine = { name: 'Box', slots: 1, live: 1 };
    const sent = await waitForSlot(
      { hub: w.hub, live, clock: w.clock },
      t,
      { principalId: chat.createdBy },
      chat,
      'Hi',
      machine,
    );
    expect(sent).toMatchObject({ ok: true, turn: { status: 'queued', machineWait: 'slots' } });
    const gone = { connected: () => undefined } as unknown as RunnerHub;
    expect(await slotsOf({ hub: gone }, t, s.machineId)).toMatchObject({ slots: 1, live: 0 });
  });
});
