import { type Chat, type ChatTurn, tenant } from '@mwc/db';
import { TEST_NOW } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ChatsLive } from '../../../../src/modules/chats/service/live.ts';
import {
  type MachineWaits,
  machineWaits,
  waitForMachine,
} from '../../../../src/modules/chats/service/machine-wait.ts';
import type { MachineWake, Woken } from '../../../../src/modules/machines/index.ts';
import { type BoxWorld, boxScene, boxWorld } from '../../../fixtures/chats/machine.ts';
import { chatRow, turnRow } from '../../../fixtures/chats/world.ts';

/** The waits' edges the routes do not reach: a runner that came up meanwhile, no wake, a wake's failures. */

let w: BoxWorld;
beforeAll(async () => {
  w = await boxWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

const live = { bus: { publish: () => undefined } } as unknown as ChatsLive;
const MACHINE = {
  id: 'm',
  name: 'Airia devbox',
  kind: 'vm',
  provider: 'airia_devbox',
  hourlyCost: null,
} as const;

/** Waits whose wake answers `woken`, counting the chats it was asked to start. */
function fakeWaits(woken: Woken | { ok: false; status: 404; code: string; message: string }) {
  const started: string[] = [];
  const waits = {
    wake: { wake: async () => woken } as unknown as MachineWake,
    watch: () => undefined,
    startNext: async (_t: unknown, chatId: string) => {
      started.push(chatId);
    },
  } as unknown as MachineWaits;
  return { waits, started };
}

describe('waitForMachine', () => {
  it('refuses as before without a wake, and records the turn and starts it at once when the runner came up meanwhile', async () => {
    const s = await boxScene(w);
    const t = await tenant(w.t.db, s.company.companyId);
    const chat = (await chatRow(w.t.db, s.chat.id)) as Chat;
    const caller = { principalId: s.company.owner.principalId };
    const deps = { live, clock: w.clock };
    expect(await waitForMachine(deps, t, caller, chat, 'hi')).toMatchObject({ code: 'machine_offline' });
    const up = fakeWaits({ ok: true, state: 'up', machine: MACHINE });
    const wake = { trigger: 'message' as const };
    const sent = await waitForMachine({ ...deps, waits: up.waits }, t, { ...caller, wake }, chat, 'hi');
    expect(sent).toMatchObject({ ok: true, turn: { status: 'queued', prompt: 'hi' } });
    expect(up.started).toEqual([chat.id]);
    const gone = fakeWaits({ ok: false, status: 404, code: 'machine_not_found', message: 'No such machine' });
    expect(
      await waitForMachine({ ...deps, waits: gone.waits }, t, { ...caller, wake }, chat, 'hi'),
    ).toMatchObject({
      code: 'machine_offline',
      message: 'No such machine',
    });
  });
});

describe('machineWaits', () => {
  it('logs what it could not do, and stops nothing that no longer waits', async () => {
    const s = await boxScene(w);
    const t = await tenant(w.t.db, s.company.companyId);
    const waits = machineWaits({
      db: w.t.db,
      logger: w.deps.logger,
      clock: w.clock,
      live,
      wake: {} as MachineWake,
      timers: { setTimeout: () => 0, clearTimeout: () => undefined },
      startNext: async () => undefined,
    });
    const nobody = '019a0000-0000-7000-8000-000000000000';
    await waits.connected({ companyId: nobody, machineId: s.box.machineId });
    await waits.failed({ companyId: nobody, machineId: s.box.machineId, message: 'x' });
    const said = (msg: string) => w.logs.filter((line) => line.msg === msg);
    expect(said('chats: could not start the turns that waited for a machine')).toHaveLength(1);
    expect(said('chats: could not fail the turns that waited for a machine')).toHaveLength(1);
    const turn = { id: nobody, chatId: s.chat.id } as ChatTurn;
    expect(await waits.stop(t, turn)).toBeUndefined();
    expect(await turnRow(w.t.db, nobody)).toBeUndefined();
  });
});
