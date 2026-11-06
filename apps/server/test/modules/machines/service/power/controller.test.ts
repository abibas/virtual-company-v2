import { type Machine, tenant } from '@mwc/db';
import { MACHINE_POWER_ERROR_MESSAGES } from '@mwc/machines-core';
import { TEST_NOW } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  command,
  failureOf,
  readingOf,
  resolveController,
} from '../../../../../src/modules/machines/service/power/controller.ts';
import { enroll, MAC, machineRow, machinesPath } from '../../../../fixtures/machines/machines.ts';
import { boxDriver, connectController, macAndBox } from '../../../../fixtures/machines/power.ts';
import { eventually, type MachinesWorld, machinesWorld } from '../../../../fixtures/machines/world.ts';
import { as, membersCompany } from '../../../../fixtures/members/members.ts';

let w: MachinesWorld;
beforeAll(async () => {
  w = await machinesWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

const CMD = '019a5b2e-0000-7000-8000-00000000c0de';
const row = async (id: string) => (await machineRow(w.t.db, id)) as Machine;

describe('failureOf', () => {
  it("reads the driver's code and message, and calls anything else a plain failure", () => {
    expect(failureOf('needs_gcloud_login: Run gcloud auth login there.')).toEqual({
      code: 'needs_gcloud_login',
      message: 'Run gcloud auth login there.',
    });
    expect(failureOf('no_power_driver')).toEqual({
      code: 'cli_missing',
      message: MACHINE_POWER_ERROR_MESSAGES.cli_missing,
    });
    expect(failureOf('made_up: something')).toEqual({ code: 'failed', message: 'made_up: something' });
    expect(failureOf('gcloud crashed')).toEqual({ code: 'failed', message: 'gcloud crashed' });
    for (const error of [undefined, '']) {
      expect(failureOf(error)).toEqual({ code: 'failed', message: MACHINE_POWER_ERROR_MESSAGES.failed });
    }
  });
});

describe('readingOf', () => {
  it('keeps what parses and makes the rest null', () => {
    const result = { type: 'power.result' as const, cmdId: CMD, ok: true };
    expect(readingOf(result)).toEqual({ status: 'unknown', size: null, hourlyCost: null, rules: null });
    const garbled = { size: 'xxl', hourlyCost: -1, rules: { timezone: 5 } };
    expect(readingOf({ ...result, status: 'running', metadata: garbled })).toEqual({
      status: 'running',
      size: null,
      hourlyCost: null,
      rules: null,
    });
  });
});

describe('resolveController', () => {
  it('picks the connected machine that can power the box when its chosen one was removed', async () => {
    const company = await membersCompany(w);
    const { mac, box } = await macAndBox(w, company);
    const gone = await enroll(w, company, { ...MAC, name: 'Old Mac' });
    await as(w, company.owner)('PATCH', machinesPath(company, `/${box.machineId}`), {
      controllerMachineId: gone.machineId,
    });
    await as(w, company.owner)('DELETE', machinesPath(company, `/${gone.machineId}`));
    await connectController(w, mac.runnerKey, boxDriver());
    const t = await tenant(w.t.db, company.companyId);
    expect(await resolveController(t, w.hub, await row(box.machineId))).toEqual({
      ok: true,
      controllerId: mac.machineId,
    });
    expect((await row(box.machineId)).controllerMachineId).toBe(mac.machineId);
  });

  it('refuses a devbox whose reference does not parse', async () => {
    const company = await membersCompany(w);
    const { box } = await macAndBox(w, company);
    const broken = { ...(await row(box.machineId)), providerRef: { instance: 'Not A Name' } };
    const t = await tenant(w.t.db, company.companyId);
    expect(await resolveController(t, w.hub, broken)).toMatchObject({ status: 422, code: 'not_a_vm' });
  });
});

describe('command', () => {
  it('is a 502 timeout when the controller does not answer, and controller_offline when it goes first', async () => {
    const company = await membersCompany(w);
    const { mac, box } = await macAndBox(w, company);
    const controller = await w.connect(mac.runnerKey, {
      caps: { power: ['airia_devbox'] },
      respond: () => [],
    });
    const machine = await row(box.machineId);
    expect(await command(w.hub, mac.machineId, machine, 'status', { timeoutMs: 50 })).toMatchObject({
      status: 502,
      code: 'power_failed',
      driverCode: 'timeout',
      message: MACHINE_POWER_ERROR_MESSAGES.timeout,
    });
    const pending = command(w.hub, mac.machineId, machine, 'stop', { timeoutMs: 5_000 });
    await eventually('the stop arrived', () => controller.frames.of('power.command').length === 2);
    await controller.disconnect();
    expect(await pending).toMatchObject({ status: 409, code: 'controller_offline' });
    expect(await command(w.hub, mac.machineId, machine, 'status')).toMatchObject({
      code: 'controller_offline',
    });
  });

  it('reads a runner without a power driver as the tools missing', async () => {
    const company = await membersCompany(w);
    const { mac, box } = await macAndBox(w, company);
    await w.connect(mac.runnerKey, {
      respond: (frame) =>
        frame.type === 'power.command'
          ? [{ type: 'power.result', cmdId: frame.cmdId, ok: false, error: 'no_power_driver' }]
          : [],
    });
    expect(await command(w.hub, mac.machineId, await row(box.machineId), 'status')).toMatchObject({
      status: 502,
      driverCode: 'cli_missing',
    });
  });
});
