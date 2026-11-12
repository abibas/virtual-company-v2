import { MACHINE_POWER_ERROR_MESSAGES } from '@mwc/machines-core';
import { TEST_NOW } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ChatDetailView, ChatTurnView } from '../../../../../src/modules/chats/schemas.ts';
import { type BoxWorld, boxScene, boxUp, boxWorld, logged } from '../../../../fixtures/chats/machine.ts';
import {
  ANSWER,
  chatPath,
  ended,
  endTurn,
  scene,
  sendEvents,
  turnRow,
} from '../../../../fixtures/chats/world.ts';
import { as } from '../../../../fixtures/members/members.ts';

/** A message to an agent whose machine is stopped: refused with Start and send, or the machine started and waited for. */

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

type Scene = Awaited<ReturnType<typeof boxScene>>;
const send = (s: Scene, body: Record<string, unknown>) =>
  as(w, s.company.owner)('POST', chatPath(s.company, s.chat.id, '/turns'), body);
const turnOf = (res: { status: number; body: unknown }) => {
  if (res.status !== 202) throw new Error(`POST turns answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as ChatTurnView;
};

describe('a message to an agent on a stopped devbox', () => {
  it('is refused with the machine when its start on a message is off, for Start and send', async () => {
    const s = await boxScene(w);
    const res = await send(s, { prompt: 'hi' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error: {
        code: 'machine_stopped',
        message: 'Airia devbox is stopped',
        machine: { id: s.box.machineId, name: 'Airia devbox', canStart: true },
      },
    });
    expect(s.driver.calls).toEqual([]);
  });

  it('starts the box on Start and send, waits for it, and sends the messages once its runner connects', async () => {
    const s = await boxScene(w);
    const first = turnOf(await send(s, { prompt: 'hi', startMachine: true }));
    expect(first).toMatchObject({
      status: 'queued',
      delivery: 'after',
      machineWaitAt: new Date(TEST_NOW).toISOString(),
    });
    const events = await logged(w, s.box.machineId, 'started');
    expect(events).toContain(`started user:${s.company.owner.userId}: Started for a message to SLOP BOX`);
    const second = turnOf(await send(s, { prompt: 'and then', delivery: 'after' }));
    expect(second).toMatchObject({ status: 'queued', machineWaitAt: null });
    const detail = await as(w, s.company.owner)('GET', chatPath(s.company, s.chat.id));
    expect((detail.body as ChatDetailView).queue).toEqual([first.id, second.id]);
    const box = await boxUp(w, s);
    const start = await box.frames.next('turn.start');
    expect(start).toMatchObject({ turnId: first.id, spec: { prompt: 'hi' } });
    sendEvents(box, first.id, ANSWER);
    endTurn(box, first.id);
    expect((await box.frames.next('turn.start')).turnId).toBe(second.id);
    expect(await ended(w.t.db, first.id)).toMatchObject({ status: 'done' });
  });

  it('starts by itself with the start on a message on, and fails the wait in words when the start fails', async () => {
    const s = await boxScene(w, { autoStartOnMessage: true });
    s.driver.failNext('start', 'stockout_or_quota');
    const turn = turnOf(await send(s, { prompt: 'hi' }));
    const why = MACHINE_POWER_ERROR_MESSAGES.stockout_or_quota;
    expect(await ended(w.t.db, turn.id)).toMatchObject({
      status: 'failed',
      error: `Airia devbox did not start: ${why}`,
    });
    expect(await logged(w, s.box.machineId, 'failed')).toContain(
      `failed auto: Started for a message to SLOP BOX, but the start failed: ${why}`,
    );
  });

  it('fails a wait after 10 minutes, and a person stops one', async () => {
    const s = await boxScene(w, { autoStartOnMessage: true });
    const late = turnOf(await send(s, { prompt: 'hi' }));
    await logged(w, s.box.machineId, 'started');
    w.clock.advance(10 * 60_000);
    while (w.waits.pending().length > 0) await w.waits.fire();
    expect(await turnRow(w.t.db, late.id)).toMatchObject({
      status: 'failed',
      error: 'Airia devbox did not connect within 10 minutes',
    });
    const waiting = turnOf(await send(s, { prompt: 'again' }));
    const stop = (id: string) =>
      as(w, s.company.owner)('POST', chatPath(s.company, s.chat.id, `/turns/${id}/stop`));
    const stopped = await stop(waiting.id);
    expect(stopped.status).toBe(202);
    expect(stopped.body).toMatchObject({ status: 'stopped', error: 'stopped' });
    expect((await stop(waiting.id)).status).toBe(409);
    // The box was read starting a moment ago: no second start was sent.
    expect(s.driver.calls.filter((call) => call.call === 'start')).toHaveLength(1);
  });
});

describe('a message to an agent on a machine nothing here starts', () => {
  it('is refused in the machine’s own words', async () => {
    const s = await scene(w, { offline: true });
    const res = await as(w, s.company.owner)('POST', chatPath(s.company, s.chat.id, '/turns'), {
      prompt: 'hi',
      startMachine: true,
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error: {
        code: 'machine_offline',
        message: 'This Mac is asleep: wake it, and its runner reconnects on its own',
      },
    });
  });
});
