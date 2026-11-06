import { machinePower, tenant } from '@mwc/db';
import { MACHINE_POWER_ERROR_MESSAGES } from '@mwc/machines-core';
import { TEST_NOW } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { RunnerHub } from '../../../../../src/modules/machines/index.ts';
import { boxCheckDue, powerScheduler } from '../../../../../src/modules/machines/service/power/scheduler.ts';
import { readPower, saveState } from '../../../../../src/modules/machines/service/power/store.ts';
import { enroll } from '../../../../fixtures/machines/machines.ts';
import {
  answer,
  boxDriver,
  connectController,
  eventsOf,
  macAndBox,
  powerPath,
  putPolicy,
} from '../../../../fixtures/machines/power.ts';
import { eventually, type MachinesWorld, machinesWorld } from '../../../../fixtures/machines/world.ts';
import { as, type MembersCompany, membersCompany } from '../../../../fixtures/members/members.ts';

let w: MachinesWorld;
beforeAll(async () => {
  w = await machinesWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

// Friday 2026-11-06: Mon–Fri 09:00–19:00 Europe/Kyiv is 07:00Z–17:00Z.
const HOURS = 'Mon–Fri 09:00–19:00 Europe/Kyiv';
const KEEP_ON = { keepOn: { enabled: true } };
const END = Date.parse('2026-11-06T17:00:00Z');

/** A scheduler on the world, and one step of it at the world's clock, its commands awaited. */
function scheduled() {
  const scheduler = powerScheduler({ db: w.t.db, hub: w.hub, logger: w.deps.logger, clock: w.clock });
  return async (at?: string) => {
    if (at !== undefined) w.clock.set(at);
    const step = await scheduler.step(w.clock());
    await scheduler.idle();
    return step;
  };
}

const stateOf = async (company: MembersCompany, machineId: string) =>
  (await readPower(await tenant(w.t.db, company.companyId), machineId)).state;
const calls = (driver: ReturnType<typeof boxDriver>) => driver.calls.map((entry) => entry.call);

describe('the power scheduler on a devbox', () => {
  it('starts the box at its hours once, holds it, leaves it off after a Stop by hand, and stops it when they end', async () => {
    w.clock.set('2026-11-06T06:59:00Z');
    const company = await membersCompany(w);
    const { mac, box } = await macAndBox(w, company);
    const driver = boxDriver();
    await connectController(w, mac.runnerKey, driver);
    await putPolicy(w, company, box.machineId, { ...KEEP_ON, autoStartAtKeepOn: true });
    const step = scheduled();
    expect((await step()).machines).toBeGreaterThan(0);
    expect(calls(driver)).toEqual(['status']);
    await step('2026-11-06T07:00:00Z');
    expect(calls(driver)).toEqual(['status', 'start']);
    expect(await stateOf(company, box.machineId)).toMatchObject({
      window: '2026-11-06',
      autoStartedWindow: '2026-11-06',
      holdUntil: '2026-11-06T17:00:00.000Z',
      box: { status: 'starting', checkedAt: '2026-11-06T07:00:00.000Z' },
    });
    const boxRunner = await w.connect(box.runnerKey);
    expect((await boxRunner.frames.next('machine.hold')).until).toBe(END);
    await step('2026-11-06T07:01:00Z');
    expect(calls(driver)).toEqual(['status', 'start']);
    w.clock.set('2026-11-06T08:00:00Z');
    expect((await as(w, company.owner)('POST', powerPath(company, box.machineId, '/stop'))).status).toBe(202);
    await step('2026-11-06T08:01:00Z');
    expect(calls(driver)).toEqual(['status', 'start', 'stop']);
    w.clock.set('2026-11-06T09:00:00Z');
    expect((await as(w, company.owner)('POST', powerPath(company, box.machineId, '/start'))).status).toBe(
      202,
    );
    await step('2026-11-06T17:00:00Z');
    expect(calls(driver)).toEqual(['status', 'start', 'stop', 'start', 'stop']);
    expect((await boxRunner.frames.next('machine.hold')).until).toBeNull();
    expect((await eventsOf(w.t.db, box.machineId)).slice(1)).toEqual([
      'held schedule: Held for the keep-on hours, until 19:00 (Europe/Kyiv)',
      `started schedule: Keep-on hours started (${HOURS})`,
      `stopped user:${company.owner.userId}: Stopped by hand`,
      `started user:${company.owner.userId}: Started by hand`,
      'released schedule: Released: outside the keep-on hours',
      `stopped schedule: Keep-on hours ended (${HOURS})`,
    ]);
    expect(await stateOf(company, box.machineId)).toMatchObject({
      window: null,
      holdUntil: null,
      holdKind: null,
    });
  });

  it('keeps the box on at the end of the hours while the hold after a turn runs, then releases it', async () => {
    w.clock.set('2026-11-06T16:59:00Z');
    const company = await membersCompany(w);
    const { mac, box } = await macAndBox(w, company);
    const driver = boxDriver('running');
    await connectController(w, mac.runnerKey, driver);
    await putPolicy(w, company, box.machineId, KEEP_ON);
    await saveState(await tenant(w.t.db, company.companyId), box.machineId, {
      lastTurnAt: '2026-11-06T16:50:00.000Z',
    });
    const step = scheduled();
    await step();
    await step('2026-11-06T17:00:00Z');
    await step('2026-11-06T17:35:00Z');
    // Read at 16:59 and again at 17:35 (5 minutes passed); never stopped.
    expect(calls(driver)).toEqual(['status', 'status']);
    expect((await eventsOf(w.t.db, box.machineId)).slice(1)).toEqual([
      'held schedule: Held for the keep-on hours, until 19:00 (Europe/Kyiv)',
      'held auto: Held for 45 minutes after the last turn',
      `kept schedule: Keep-on hours ended (${HOURS}) while the hold after the last turn runs; left on, the box's own rules stop it later`,
      'released auto: Released: the hold after the last turn ended',
    ]);
  });

  it('waits for a controller to start the box, and logs a stop it cannot make', async () => {
    w.clock.set('2026-11-06T07:00:00Z');
    const company = await membersCompany(w);
    const { mac, box } = await macAndBox(w, company);
    await putPolicy(w, company, box.machineId, { ...KEEP_ON, autoStartAtKeepOn: true });
    const step = scheduled();
    expect((await step()).commands).toBe(0);
    expect(await stateOf(company, box.machineId)).toMatchObject({
      window: '2026-11-06',
      autoStartedWindow: null,
    });
    const driver = boxDriver();
    const controller = await connectController(w, mac.runnerKey, driver);
    await step('2026-11-06T07:01:00Z');
    expect(calls(driver)).toEqual(['start']);
    await controller.disconnect();
    await eventually('the controller is gone', () => !w.hub.isOnline(mac.machineId));
    await step('2026-11-06T17:00:00Z');
    expect((await eventsOf(w.t.db, box.machineId)).at(-1)).toBe(
      `failed schedule: Keep-on hours ended (${HOURS}), but the box could not be stopped: The machine that powers this box is not connected`,
    );
    expect(await stateOf(company, box.machineId)).toMatchObject({ window: null });
  });

  it('logs a start that fails and keeps the error, once per window', async () => {
    w.clock.set('2026-11-06T07:00:00Z');
    const company = await membersCompany(w);
    const { mac, box } = await macAndBox(w, company);
    const driver = boxDriver();
    driver.failNext('start', 'stockout_or_quota');
    await connectController(w, mac.runnerKey, driver);
    await putPolicy(w, company, box.machineId, { ...KEEP_ON, autoStartAtKeepOn: true });
    const step = scheduled();
    await step();
    await step('2026-11-06T07:01:00Z');
    expect(calls(driver)).toEqual(['start']);
    expect((await eventsOf(w.t.db, box.machineId)).at(-1)).toBe(
      `failed schedule: Keep-on hours started (${HOURS}), but the start failed: ${MACHINE_POWER_ERROR_MESSAGES.stockout_or_quota}`,
    );
    expect((await stateOf(company, box.machineId)).box?.error?.code).toBe('stockout_or_quota');
  });

  it('reads the box at most every 5 minutes, keeping a failed reading without logging it', async () => {
    const company = await membersCompany(w);
    const { mac, box } = await macAndBox(w, company);
    const driver = boxDriver('running');
    await connectController(w, mac.runnerKey, driver);
    const step = scheduled();
    await step();
    w.clock.advance(4 * 60_000);
    await step();
    expect(calls(driver)).toEqual(['status']);
    expect(await stateOf(company, box.machineId)).toMatchObject({ box: { status: 'running', error: null } });
    driver.failNext('status', 'needs_gcloud_login');
    w.clock.advance(60_000);
    await step();
    expect(calls(driver)).toEqual(['status', 'status']);
    expect(await stateOf(company, box.machineId)).toMatchObject({
      box: {
        status: 'running',
        error: { code: 'needs_gcloud_login' },
        checkedAt: '2026-11-03T12:05:00.000Z',
      },
    });
    expect(await eventsOf(w.t.db, box.machineId)).toEqual([]);
  });
});

describe('the power scheduler when a command is slow or something breaks', () => {
  it('decides only the hold of a machine whose command still runs', async () => {
    w.clock.set('2026-11-06T06:00:00Z');
    const company = await membersCompany(w);
    const { mac, box } = await macAndBox(w, company);
    const driver = boxDriver('running');
    const waiting: (() => void)[] = [];
    const holder: { runner?: Awaited<ReturnType<MachinesWorld['connect']>> } = {};
    holder.runner = await w.connect(mac.runnerKey, {
      caps: { power: ['airia_devbox'] },
      respond: (frame) => {
        if (frame.type !== 'power.command')
          return 'cmdId' in frame ? [{ type: 'cmd.ack', cmdId: frame.cmdId, ok: true }] : [];
        waiting.push(() => void answer(driver, frame).then((result) => holder.runner?.send(result)));
        return [];
      },
    });
    await putPolicy(w, company, box.machineId, KEEP_ON);
    const scheduler = powerScheduler({ db: w.t.db, hub: w.hub, logger: w.deps.logger, clock: w.clock });
    await scheduler.step(w.clock());
    await eventually('the reading was asked for', () => waiting.length === 1);
    w.clock.set('2026-11-06T07:00:00Z');
    await scheduler.step(w.clock());
    expect(await stateOf(company, box.machineId)).toMatchObject({
      holdUntil: '2026-11-06T17:00:00.000Z',
      window: null,
      box: null,
    });
    waiting[0]?.();
    await scheduler.idle();
    expect((await stateOf(company, box.machineId)).box?.status).toBe('running');
    expect(calls(driver)).toEqual(['status']);
  });

  it('logs a machine it cannot decide and a command that throws, and goes on', async () => {
    const company = await membersCompany(w);
    const { mac, box } = await macAndBox(w, company);
    await connectController(w, mac.runnerKey, boxDriver('running'));
    const said = (msg: string) =>
      w.logs.filter((line) => line.msg === msg && line.machineId === box.machineId);
    const lost: RunnerHub = {
      ...w.hub,
      connected: () => {
        throw new Error('the hub lost its runners');
      },
    };
    const deps = { db: w.t.db, logger: w.deps.logger, clock: w.clock };
    const first = powerScheduler({ ...deps, hub: lost });
    await first.step(w.clock());
    expect(said('power: could not decide for a machine')).toHaveLength(1);
    const broken: RunnerHub = { ...w.hub, request: () => Promise.reject(new Error('the socket broke')) };
    const second = powerScheduler({ ...deps, hub: broken });
    await second.step(w.clock());
    await second.idle();
    expect(said('power: a scheduled command failed')).toHaveLength(1);
  });
});

describe('the power scheduler on other machines', () => {
  it('holds a Mac only when it keeps it awake, and holds a container', async () => {
    w.clock.set('2026-11-06T12:00:00Z');
    const company = await membersCompany(w);
    const mac = await enroll(w, company);
    const container = await enroll(w, company, { name: 'Box in Docker', kind: 'container' });
    const t = await tenant(w.t.db, company.companyId);
    for (const machineId of [mac.machineId, container.machineId]) {
      await t.insert(machinePower, { machineId, policy: { ...KEEP_ON, keepMacAwake: false } });
    }
    const runner = await w.connect(mac.runnerKey);
    await scheduled()();
    expect(await stateOf(company, mac.machineId)).toMatchObject({ holdUntil: null });
    expect(await stateOf(company, container.machineId)).toMatchObject({
      holdUntil: '2026-11-06T17:00:00.000Z',
    });
    expect(runner.frames.of('machine.hold').every((frame) => frame.until === null)).toBe(true);
  });
});

describe('boxCheckDue', () => {
  it('is due for a box never read, or read 5 minutes ago', () => {
    const now = new Date('2026-11-06T12:00:00Z');
    const read = (checkedAt: string | null) => ({
      status: 'running' as const,
      size: null,
      hourlyCost: null,
      rules: null,
      checkedAt,
      error: null,
    });
    expect(boxCheckDue(null, now)).toBe(true);
    expect(boxCheckDue(read(null), now)).toBe(true);
    expect(boxCheckDue(read('2026-11-06T11:55:00.000Z'), now)).toBe(true);
    expect(boxCheckDue(read('2026-11-06T11:55:01.000Z'), now)).toBe(false);
  });
});
