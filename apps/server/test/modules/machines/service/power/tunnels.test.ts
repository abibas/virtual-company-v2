import { type TenantDb, tenant } from '@mwc/db';
import type { TunnelSet } from '@mwc/shared/runner-protocol';
import { brokenDb, TEST_NOW } from '@mwc/testkit';
import type { FakeRunner } from '@mwc/testkit/runner';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { machineUpkeep } from '../../../../../src/modules/machines/index.ts';
import {
  linkEnrolledBox,
  tunnelsOnConnect,
} from '../../../../../src/modules/machines/service/power/control.ts';
import { powerScheduler } from '../../../../../src/modules/machines/service/power/scheduler.ts';
import { saveState } from '../../../../../src/modules/machines/service/power/store.ts';
import { wantedTunnels } from '../../../../../src/modules/machines/service/power/tunnels.ts';
import { DEVBOX, enroll, MAC, machinesPath } from '../../../../fixtures/machines/machines.ts';
import {
  BOX_REF,
  boxDriver,
  connectController,
  macAndBox,
  powerPath,
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

/** The app's own port (`testConfig`): both ends of every tunnel. */
const PORT = 9950;
/** A box's tunnel; `running` while its last reading says it runs. */
const tunnelTo = (machineId: string, port = PORT, running = false) => ({
  machineId,
  target: { provider: 'airia_devbox', ref: BOX_REF },
  remotePort: port,
  localPort: port,
  running,
});

/** The controller's next `tunnel.set`, as the machines it names. */
const nextSet = async (runner: FakeRunner) => (await runner.frames.next('tunnel.set')).tunnels;
const setsOf = (runner: FakeRunner): TunnelSet['tunnels'][] =>
  runner.frames.of('tunnel.set').map((frame) => frame.tunnels);

/** A company's Mac and devbox, the box's controller saved as the Mac while it is not connected. */
async function savedController(company: MembersCompany) {
  const { mac, box } = await macAndBox(w, company);
  const res = await as(w, company.owner)('PATCH', machinesPath(company, `/${box.machineId}`), {
    controllerMachineId: mac.machineId,
  });
  expect(res.status).toBe(200);
  return { mac, box };
}

const scheduler = (port?: number) =>
  powerScheduler({ db: w.t.db, hub: w.hub, logger: w.deps.logger, clock: w.clock, port });

describe('the tunnels a controller is sent', () => {
  it('come when the controller says hello: its running box, nothing for a runner that powers nothing', async () => {
    const company = await membersCompany(w);
    const { mac, box } = await savedController(company);
    const controller = await connectController(w, mac.runnerKey, boxDriver('running'));
    expect(await nextSet(controller)).toEqual([tunnelTo(box.machineId)]);
    const boxRunner = await w.connect(box.runnerKey);
    await boxRunner.frames.next('machine.hold');
    expect(boxRunner.frames.of('tunnel.set')).toEqual([]);
  });

  it('come after a devbox enrolls, its controller saved when exactly one connected runner can power it', async () => {
    const company = await membersCompany(w);
    const mac = await enroll(w, company, MAC);
    const controller = await connectController(w, mac.runnerKey, boxDriver('running'));
    expect(await nextSet(controller)).toEqual([]);
    const box = await enroll(w, company, DEVBOX);
    expect(await nextSet(controller)).toEqual([tunnelTo(box.machineId)]);
    const t = await tenant(w.t.db, company.companyId);
    expect(await wantedTunnels(t, mac.machineId, 9963)).toEqual([tunnelTo(box.machineId, 9963)]);
  });

  it('follow the box stopped by hand and started again, its removal, and are not sent again unchanged', async () => {
    const company = await membersCompany(w);
    const { mac, box } = await savedController(company);
    const controller = await connectController(w, mac.runnerKey, boxDriver('running', 'immediately'));
    expect(await nextSet(controller)).toEqual([tunnelTo(box.machineId)]);
    const stop = await as(w, company.owner)('POST', powerPath(company, box.machineId, '/stop'));
    expect(stop.status).toBe(202);
    expect(await nextSet(controller)).toEqual([]);
    await as(w, company.owner)('POST', powerPath(company, box.machineId, '/start'));
    // The start read it running: the set says so, for the holder's quicker retries.
    expect(await nextSet(controller)).toEqual([tunnelTo(box.machineId, PORT, true)]);
    // A scheduler step reads the box (running, unchanged) and sends nothing new.
    const step = scheduler(PORT);
    w.clock.advance(10 * 60_000);
    await step.step(w.clock());
    await step.idle();
    expect(setsOf(controller)).toHaveLength(3);
    expect(await as(w, company.owner)('DELETE', machinesPath(company, `/${box.machineId}`))).toMatchObject({
      status: 204,
    });
    expect(await nextSet(controller)).toEqual([]);
  });

  it('move with the box to its new controller, and the old one drops it', async () => {
    const company = await membersCompany(w);
    const { mac, box } = await savedController(company);
    const other = await enroll(w, company, { ...MAC, name: 'Spare Mac' });
    const first = await connectController(w, mac.runnerKey, boxDriver('running'));
    const second = await connectController(w, other.runnerKey, boxDriver('running'));
    expect(await nextSet(first)).toEqual([tunnelTo(box.machineId)]);
    expect(await nextSet(second)).toEqual([]);
    await as(w, company.owner)('PATCH', machinesPath(company, `/${box.machineId}`), {
      controllerMachineId: other.machineId,
    });
    expect(await nextSet(first)).toEqual([]);
    expect(await nextSet(second)).toEqual([tunnelTo(box.machineId)]);
    await as(w, company.owner)('PATCH', machinesPath(company, `/${box.machineId}`), { name: 'The box' });
    await w.hub.idle();
    expect([setsOf(first).length, setsOf(second).length]).toEqual([2, 2]);
  });

  it("never name another company's boxes", async () => {
    const [a, b] = [await membersCompany(w), await membersCompany(w)];
    const ofA = await savedController(a);
    const ofB = await savedController(b);
    const controllerA = await connectController(w, ofA.mac.runnerKey, boxDriver('running'));
    const controllerB = await connectController(w, ofB.mac.runnerKey, boxDriver('running'));
    expect(await nextSet(controllerA)).toEqual([tunnelTo(ofA.box.machineId)]);
    expect(await nextSet(controllerB)).toEqual([tunnelTo(ofB.box.machineId)]);
    const tA = await tenant(w.t.db, a.companyId);
    expect(await wantedTunnels(tA, ofB.mac.machineId, PORT)).toEqual([]);
  });

  it("are the scheduler's safety net: a stored status that changed is sent at its next step, on the server's port", async () => {
    const company = await membersCompany(w);
    const { mac, box } = await savedController(company);
    const controller = await connectController(w, mac.runnerKey, boxDriver('running'));
    expect(await nextSet(controller)).toEqual([tunnelTo(box.machineId)]);
    const t = await tenant(w.t.db, company.companyId);
    const checkedAt = w.clock().toISOString();
    const box0 = { size: null, hourlyCost: null, rules: null, checkedAt, error: null };
    await saveState(t, box.machineId, { box: { ...box0, status: 'stopped' } });
    await scheduler().step(w.clock());
    expect(setsOf(controller)).toHaveLength(1);
    await scheduler(PORT).step(w.clock());
    expect(await nextSet(controller)).toEqual([]);
    await saveState(t, box.machineId, { box: { ...box0, status: 'starting' } });
    const upkeep = machineUpkeep({ ...w.deps, hub: w.hub, clock: w.clock, config: { MWC_PORT: 9963 } });
    await upkeep();
    expect(await nextSet(controller)).toEqual([tunnelTo(box.machineId, 9963)]);
  });
});

describe('when the tunnels cannot be sent', () => {
  it('logs a controller that could not get them, and an enrolled box that could not be linked', async () => {
    const deps = { db: brokenDb(), hub: w.hub, port: PORT, logger: w.deps.logger };
    const runner = {
      companyId: '019a0000-0000-7000-8000-000000000001',
      machineId: '019a0000-0000-7000-8000-000000000002',
      version: '1.0.0',
      caps: {
        harnesses: [],
        slots: 0,
        hold: 'none' as const,
        power: ['airia_devbox' as const],
        terminal: false,
        selfUpdate: false,
        folders: false,
        forks: false,
        reattach: false,
        agentTools: false,
      },
      builtAt: null,
      build: null,
      connectedAt: TEST_NOW_DATE,
    };
    tunnelsOnConnect(deps)(runner);
    tunnelsOnConnect(deps)({ ...runner, caps: { ...runner.caps, power: [] } });
    await eventually('the failure is logged', () =>
      w.logs.some((line) => line.msg === 'power: could not send a controller its tunnels'),
    );
    expect(
      w.logs.filter((line) => line.msg === 'power: could not send a controller its tunnels'),
    ).toHaveLength(1);
    const broken = {
      select: () => {
        throw new Error('the database is gone');
      },
    } as unknown as TenantDb;
    await linkEnrolledBox(deps, broken, runner.machineId);
    expect(w.logs.map((line) => line.msg)).toContain('power: could not link an enrolled devbox');
  });

  it('links nothing for a machine that is gone or no devbox', async () => {
    const company = await membersCompany(w);
    const mac = await enroll(w, company, MAC);
    const t = await tenant(w.t.db, company.companyId);
    const deps = { db: w.t.db, hub: w.hub, port: PORT, logger: w.deps.logger };
    const before = w.logs.length;
    await linkEnrolledBox(deps, t, mac.machineId);
    await linkEnrolledBox(deps, t, '019a0000-0000-7000-8000-0000000000ff');
    expect(w.logs.slice(before).map((line) => line.msg)).not.toContain(
      'power: could not link an enrolled devbox',
    );
  });
});

const TEST_NOW_DATE = new Date(TEST_NOW);
