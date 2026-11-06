import { MACHINE_POWER_ERROR_MESSAGES } from '@mwc/machines-core';
import { TEST_NOW } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { MachinePowerView } from '../../../../../src/modules/machines/schemas/power.ts';
import { call } from '../../../../fixtures/companies/companies.ts';
import { auditOf, enroll, MAC, machineRow, machinesPath } from '../../../../fixtures/machines/machines.ts';
import {
  boxDriver,
  connectController,
  eventsOf,
  macAndBox,
  powerPath,
  powerRow,
} from '../../../../fixtures/machines/power.ts';
import { type MachinesWorld, machinesWorld } from '../../../../fixtures/machines/world.ts';
import { addMember, as, membersCompany } from '../../../../fixtures/members/members.ts';

let w: MachinesWorld;
beforeAll(async () => {
  w = await machinesWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

const viewOf = (body: unknown) => body as MachinePowerView;
const RULES = {
  timezone: 'America/Chicago',
  idleShutdownMin: 45,
  idleOffhoursMin: 20,
  idleLoadThreshold: 0.5,
  workStartHour: 8,
  workEndHour: 19,
  nightlyStopHour: 20,
};

describe('POST .../power/start and /stop', () => {
  it('starts and stops the devbox through the one machine that can power it, saved as its controller', async () => {
    const company = await membersCompany(w);
    const admin = await addMember(w, company, 'admin');
    const { mac, box } = await macAndBox(w, company);
    const driver = boxDriver();
    await connectController(w, mac.runnerKey, driver);
    const started = await as(w, admin)('POST', powerPath(company, box.machineId, '/start'));
    expect(started.status).toBe(202);
    expect(viewOf(started.body)).toMatchObject({
      box: {
        status: 'starting',
        size: 'm',
        hourlyCost: 0.268,
        rules: RULES,
        checkedAt: TEST_NOW,
        error: null,
      },
      controller: { machineId: mac.machineId, name: 'This Mac', online: true },
      canControl: true,
    });
    expect(driver.calls.map((entry) => entry.call)).toEqual(['start']);
    expect(await machineRow(w.t.db, box.machineId)).toMatchObject({
      controllerMachineId: mac.machineId,
      hourlyCost: 0.268,
    });
    expect(await auditOf(w.t.db, 'machine', box.machineId)).toContain('update controllerMachineId');
    w.clock.advance(60_000);
    const stopped = await as(w, admin)('POST', powerPath(company, box.machineId, '/stop'));
    expect(stopped).toMatchObject({
      status: 202,
      body: { state: { manualStopAt: '2026-11-03T12:01:00.000Z' } },
    });
    expect(viewOf(stopped.body).box?.status).toBe('stopping');
    expect(await eventsOf(w.t.db, box.machineId)).toEqual([
      `started user:${admin.userId}: Started by hand`,
      `stopped user:${admin.userId}: Stopped by hand`,
    ]);
  });

  it('answers a failed command with 502 power_failed, the driver code and plain words, and logs it', async () => {
    const company = await membersCompany(w);
    const { mac, box } = await macAndBox(w, company);
    const driver = boxDriver();
    driver.failNext('start', 'needs_gcloud_login');
    await connectController(w, mac.runnerKey, driver);
    const res = await as(w, company.owner)('POST', powerPath(company, box.machineId, '/start'));
    expect(res).toMatchObject({
      status: 502,
      body: {
        error: {
          code: 'power_failed',
          driverCode: 'needs_gcloud_login',
          message: MACHINE_POWER_ERROR_MESSAGES.needs_gcloud_login,
          requestId: expect.any(String),
        },
      },
    });
    expect(await eventsOf(w.t.db, box.machineId)).toEqual([
      `failed user:${company.owner.userId}: Starting the box failed: ${MACHINE_POWER_ERROR_MESSAGES.needs_gcloud_login}`,
    ]);
    const power = await as(w, company.owner)('GET', powerPath(company, box.machineId));
    expect(viewOf(power.body).box).toMatchObject({
      status: 'unknown',
      checkedAt: TEST_NOW,
      error: { code: 'needs_gcloud_login', message: MACHINE_POWER_ERROR_MESSAGES.needs_gcloud_login },
    });
    driver.failNext('stop', 'failed', 'The airia CLI powers only dev-someone-else.');
    const stop = await as(w, company.owner)('POST', powerPath(company, box.machineId, '/stop'));
    expect(stop).toMatchObject({
      status: 502,
      body: { error: { driverCode: 'failed', message: 'The power command failed.' } },
    });
    expect((await eventsOf(w.t.db, box.machineId)).at(-1)).toBe(
      `failed user:${company.owner.userId}: Stopping the box failed: The airia CLI powers only dev-someone-else.`,
    );
  });

  it('is 422 for a machine that is not a devbox, and 409 without a connected controller', async () => {
    const company = await membersCompany(w);
    const { mac, box } = await macAndBox(w, company);
    const start = (machineId: string) =>
      as(w, company.owner)('POST', powerPath(company, machineId, '/start'));
    expect(await start(mac.machineId)).toMatchObject({ status: 422, body: { error: { code: 'not_a_vm' } } });
    expect(await start(box.machineId)).toMatchObject({
      status: 409,
      body: { error: { code: 'no_controller' } },
    });
    // A Mac whose runner cannot power anything is no controller either.
    const plain = await w.connect(mac.runnerKey);
    expect(await start(box.machineId)).toMatchObject({
      status: 409,
      body: { error: { code: 'no_controller' } },
    });
    await plain.disconnect();
    // Two that can: the admin must choose.
    const second = await enroll(w, company, { ...MAC, name: 'Second Mac' });
    await connectController(w, mac.runnerKey, boxDriver());
    await connectController(w, second.runnerKey, boxDriver());
    expect(await start(box.machineId)).toMatchObject({
      status: 409,
      body: { error: { code: 'no_controller', message: expect.stringContaining('choose its controller') } },
    });
    await w.disconnectAll();
    // A chosen controller that is not connected.
    await as(w, company.owner)('PATCH', machinesPath(company, `/${box.machineId}`), {
      controllerMachineId: mac.machineId,
    });
    expect(await start(box.machineId)).toMatchObject({
      status: 409,
      body: { error: { code: 'controller_offline' } },
    });
    expect(await eventsOf(w.t.db, box.machineId)).toEqual([]);
  });

  it('is refused without a credential, below admin, and for another company', async () => {
    const company = await membersCompany(w);
    const other = await membersCompany(w);
    const { box } = await macAndBox(w, company);
    for (const action of ['/start', '/stop', '/timezone']) {
      const path = powerPath(company, box.machineId, action);
      const body = action === '/timezone' ? { timezone: 'Europe/Kyiv' } : undefined;
      expect((await call(w, undefined)('POST', path, body)).status).toBe(401);
      expect((await as(w, await addMember(w, company, 'member'))('POST', path, body)).status).toBe(403);
      expect((await as(w, await addMember(w, company, 'viewer'))('POST', path, body)).status).toBe(403);
      expect((await as(w, other.owner)('POST', path, body)).status).toBe(404);
    }
    const theirs = await enroll(w, other);
    expect((await as(w, company.owner)('POST', powerPath(company, theirs.machineId, '/start'))).status).toBe(
      404,
    );
  });
});

describe('POST .../power/timezone', () => {
  it("sets the box's own time zone through its controller and logs it", async () => {
    const company = await membersCompany(w);
    const { mac, box } = await macAndBox(w, company);
    const driver = boxDriver();
    await connectController(w, mac.runnerKey, driver);
    const res = await as(w, company.owner)('POST', powerPath(company, box.machineId, '/timezone'), {
      timezone: 'Europe/Kyiv',
    });
    expect(res.status).toBe(200);
    expect(viewOf(res.body).box?.rules?.timezone).toBe('Europe/Kyiv');
    expect(driver.calls).toEqual([
      { call: 'setTimezone', instance: 'dev-ihorherasko', timezone: 'Europe/Kyiv' },
    ]);
    expect(await eventsOf(w.t.db, box.machineId)).toEqual([
      `timezone user:${company.owner.userId}: The box's time zone is now Europe/Kyiv`,
    ]);
    driver.failNext('setTimezone', 'timeout');
    const failed = await as(w, company.owner)('POST', powerPath(company, box.machineId, '/timezone'), {
      timezone: 'Asia/Tokyo',
    });
    expect(failed).toMatchObject({ status: 502, body: { error: { driverCode: 'timeout' } } });
    expect((await eventsOf(w.t.db, box.machineId)).at(-1)).toMatch(
      /^failed .*: Setting the box's time zone to Asia\/Tokyo failed: /,
    );
  });

  it('refuses a name that is not a time zone, and a machine that is not a devbox', async () => {
    const company = await membersCompany(w);
    const { mac, box } = await macAndBox(w, company);
    for (const timezone of ['+02:00', 'Mars/Olympus', '']) {
      const res = await as(w, company.owner)('POST', powerPath(company, box.machineId, '/timezone'), {
        timezone,
      });
      expect(res.status).toBe(400);
    }
    const laptop = await as(w, company.owner)('POST', powerPath(company, mac.machineId, '/timezone'), {
      timezone: 'Europe/Kyiv',
    });
    expect(laptop).toMatchObject({ status: 422, body: { error: { code: 'not_a_vm' } } });
    expect(await powerRow(w.t.db, box.machineId)).toBeUndefined();
  });
});
