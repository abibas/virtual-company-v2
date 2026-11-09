import { type Machine, tenant } from '@mwc/db';
import { MACHINE_POWER_ERROR_MESSAGES, type MachinePowerDriver, MachinePowerError } from '@mwc/machines-core';
import type { PowerAction } from '@mwc/shared/machines';
import { TEST_NOW } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { MachinePowerView } from '../../../../../../src/modules/machines/schemas/power.ts';
import { serverControl } from '../../../../../../src/modules/machines/service/power/control/server.ts';
import { powerScheduler } from '../../../../../../src/modules/machines/service/power/scheduler.ts';
import { type FakeLocalPower, fakeLocalPower } from '../../../../../fixtures/machines/local-power.ts';
import { DEVBOX, enroll, MAC, machineRow, machinesPath } from '../../../../../fixtures/machines/machines.ts';
import {
  boxDriver,
  connectController,
  eventsOf,
  powerPath,
  putPolicy,
} from '../../../../../fixtures/machines/power.ts';
import { type MachinesWorld, machinesWorld } from '../../../../../fixtures/machines/world.ts';
import { as, type MembersCompany, membersCompany } from '../../../../../fixtures/members/members.ts';

let w: MachinesWorld;
let power: FakeLocalPower;
beforeAll(async () => {
  power = fakeLocalPower(boxDriver());
  w = await machinesWorld({}, { local: power.local });
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

const viewOf = (body: unknown) => body as MachinePowerView;
const SERVER = { kind: 'server', machineId: null, name: 'This server (airia CLI)', online: true };
const row = async (id: string) => (await machineRow(w.t.db, id)) as Machine;

/** A company with its devbox only: no runner anywhere. */
async function boxOnly(driver = boxDriver()) {
  power.use(driver);
  const company = await membersCompany(w);
  const box = await enroll(w, company, DEVBOX);
  return { company, box, driver };
}

const post = (company: MembersCompany, machineId: string, action: string, body?: unknown) =>
  as(w, company.owner)('POST', powerPath(company, machineId, action), body);

describe("this server's own driver through the API", () => {
  it('starts and stops the devbox in-process with no runner, names itself the controller, and logs it', async () => {
    const { company, box, driver } = await boxOnly();
    expect(w.control.kind).toBe('server');
    const view = await as(w, company.owner)('GET', powerPath(company, box.machineId));
    expect(viewOf(view.body).controller).toEqual(SERVER);
    const started = await post(company, box.machineId, '/start');
    expect(started.status).toBe(202);
    expect(viewOf(started.body)).toMatchObject({
      box: { status: 'starting', size: 'm', hourlyCost: 0.268, checkedAt: TEST_NOW, error: null },
      controller: SERVER,
    });
    w.clock.advance(60_000);
    expect(viewOf((await post(company, box.machineId, '/stop')).body).box?.status).toBe('stopping');
    expect(driver.calls.map((entry) => entry.call)).toEqual(['start', 'stop']);
    expect(await eventsOf(w.t.db, box.machineId)).toEqual([
      `started user:${company.owner.userId}: Started by hand`,
      `stopped user:${company.owner.userId}: Stopped by hand`,
    ]);
    // No runner was chosen or saved for it.
    expect((await row(box.machineId)).controllerMachineId).toBeNull();
  });

  it("sets the box's time zone, and answers the driver's errors as power_failed with its code, logged", async () => {
    const { company, box, driver } = await boxOnly();
    const zone = await post(company, box.machineId, '/timezone', { timezone: 'Europe/Kyiv' });
    expect(zone.status).toBe(200);
    expect(viewOf(zone.body).box?.rules?.timezone).toBe('Europe/Kyiv');
    driver.failNext('start', 'needs_gcloud_login');
    expect(await post(company, box.machineId, '/start')).toMatchObject({
      status: 502,
      body: {
        error: {
          code: 'power_failed',
          driverCode: 'needs_gcloud_login',
          message: MACHINE_POWER_ERROR_MESSAGES.needs_gcloud_login,
        },
      },
    });
    driver.failNext('setTimezone', 'stockout_or_quota', 'No room in europe-west1-b.');
    expect(await post(company, box.machineId, '/timezone', { timezone: 'Asia/Tokyo' })).toMatchObject({
      status: 502,
      body: { error: { driverCode: 'stockout_or_quota' } },
    });
    expect(await eventsOf(w.t.db, box.machineId)).toEqual([
      `timezone user:${company.owner.userId}: The box's time zone is now Europe/Kyiv`,
      `failed user:${company.owner.userId}: Starting the box failed: ${MACHINE_POWER_ERROR_MESSAGES.needs_gcloud_login}`,
      `failed user:${company.owner.userId}: Setting the box's time zone to Asia/Tokyo failed: No room in europe-west1-b.`,
    ]);
    const after = await as(w, company.owner)('GET', powerPath(company, box.machineId));
    expect(viewOf(after.body).box?.error).toEqual({
      code: 'stockout_or_quota',
      message: 'No room in europe-west1-b.',
    });
  });

  it('refuses a machine that is not a devbox, and names no controller for it', async () => {
    const company = await membersCompany(w);
    const mac = await enroll(w, company, MAC);
    expect(await post(company, mac.machineId, '/start')).toMatchObject({
      status: 422,
      body: { error: { code: 'not_a_vm' } },
    });
    const view = await as(w, company.owner)('GET', powerPath(company, mac.machineId));
    expect(viewOf(view.body).controller).toBeNull();
  });

  it('never sends a runner that could power the box a power command, and sends it an empty tunnel set', async () => {
    const { company, box, driver } = await boxOnly(boxDriver('running'));
    const mac = await enroll(w, company, MAC);
    await as(w, company.owner)('PATCH', machinesPath(company, `/${box.machineId}`), {
      controllerMachineId: mac.machineId,
    });
    const runnerDriver = boxDriver('running');
    const runner = await connectController(w, mac.runnerKey, runnerDriver);
    expect((await runner.frames.next('tunnel.set')).tunnels).toEqual([]);
    const stopped = await post(company, box.machineId, '/stop');
    expect(viewOf(stopped.body).controller).toEqual(SERVER);
    expect(driver.calls.map((entry) => entry.call)).toEqual(['stop']);
    expect(runner.frames.of('power.command')).toEqual([]);
    expect(runnerDriver.calls).toEqual([]);
    expect(runner.frames.of('tunnel.set').map((frame) => frame.tunnels)).toEqual([[]]);
  });
});

describe('the scheduler on it', () => {
  it('reads, starts and stops the box through this server, as the schedule, with no runner', async () => {
    w.clock.set('2026-11-06T06:59:00Z');
    const { company, box, driver } = await boxOnly();
    await putPolicy(w, company, box.machineId, { keepOn: { enabled: true }, autoStartAtKeepOn: true });
    const scheduler = powerScheduler({
      db: w.t.db,
      hub: w.hub,
      logger: w.deps.logger,
      clock: w.clock,
      control: w.control,
    });
    const step = async (at: string) => {
      w.clock.set(at);
      await scheduler.step(w.clock());
      await scheduler.idle();
    };
    await step('2026-11-06T06:59:00Z');
    await step('2026-11-06T07:00:00Z');
    await step('2026-11-06T17:00:00Z');
    // Every devbox of every company is read through this server; only this one has hours to start and stop it.
    expect(driver.calls.map((entry) => entry.call).filter((call) => call !== 'status')).toEqual([
      'start',
      'stop',
    ]);
    expect(driver.calls[0]?.call).toBe('status');
    const events = await eventsOf(w.t.db, box.machineId);
    expect(events.filter((event) => event.startsWith('started') || event.startsWith('stopped'))).toEqual([
      'started schedule: Keep-on hours started (Mon–Fri 09:00–19:00 Europe/Kyiv)',
      'stopped schedule: Keep-on hours ended (Mon–Fri 09:00–19:00 Europe/Kyiv)',
    ]);
  });
});

describe('its commands', () => {
  /** A driver like `boxDriver()` whose `status` is this one. */
  const statusOnly = (status: MachinePowerDriver['status']): MachinePowerDriver => {
    const base = boxDriver();
    return {
      provider: 'airia_devbox',
      discover: () => base.discover(),
      status,
      start: (ref) => base.start(ref),
      stop: (ref) => base.stop(ref),
      setTimezone: (ref, timezone) => base.setTimezone(ref, timezone),
    };
  };

  /** One command on a new company's devbox through a control of its own on `driver`. */
  async function runOn(driver: MachinePowerDriver, action: PowerAction, timeoutsMs = {}) {
    const company = await membersCompany(w);
    const box = await enroll(w, company, DEVBOX);
    const local = fakeLocalPower(driver).local;
    const control = serverControl({ hub: w.hub, port: 9950, local, timeoutsMs });
    const controller = await control.resolve(
      await tenant(w.t.db, company.companyId),
      await row(box.machineId),
    );
    if (!controller.ok) throw new Error(`refused: ${controller.code}`);
    return controller.run(action);
  }

  it('are a 502 timeout when the driver does not answer in time', async () => {
    const hanging = statusOnly(() => new Promise<never>(() => {}));
    expect(await runOn(hanging, 'status', { status: 20 })).toMatchObject({
      status: 502,
      code: 'power_failed',
      driverCode: 'timeout',
      detail: 'No answer from the airia CLI within 20 ms',
      message: MACHINE_POWER_ERROR_MESSAGES.timeout,
    });
  });

  it('read an error that is not a power error as a plain failure, and a missing time zone as a bad one', async () => {
    const crashed = statusOnly(() => Promise.reject(new Error('gcloud crashed')));
    expect(await runOn(crashed, 'status')).toMatchObject({ driverCode: 'failed', detail: 'gcloud crashed' });
    const silent = statusOnly(() => Promise.reject(new Error('')));
    expect(await runOn(silent, 'status')).toMatchObject({
      driverCode: 'failed',
      detail: 'the power command failed',
    });
    const gone = statusOnly(() => Promise.reject(new MachinePowerError('not_found', 'gone')));
    expect(await runOn(gone, 'status')).toMatchObject({ driverCode: 'not_found', detail: 'gone' });
    expect(await runOn(boxDriver(), 'set_timezone')).toMatchObject({ driverCode: 'failed' });
  });
});
