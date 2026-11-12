import { tenant } from '@mwc/db';
import { TEST_NOW } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { MachineView } from '../../../../../../../src/modules/machines/schemas.ts';
import { serverControl } from '../../../../../../../src/modules/machines/service/power/control/server.ts';
import { powerScheduler } from '../../../../../../../src/modules/machines/service/power/scheduler.ts';
import { saveState } from '../../../../../../../src/modules/machines/service/power/store.ts';
import { type FakeLocalPower, fakeLocalPower } from '../../../../../../fixtures/machines/local-power.ts';
import { DEVBOX, enroll, MAC, machinesPath } from '../../../../../../fixtures/machines/machines.ts';
import {
  BOX_REF,
  boxDriver,
  connectController,
  powerPath,
} from '../../../../../../fixtures/machines/power.ts';
import { eventually, type MachinesWorld, machinesWorld } from '../../../../../../fixtures/machines/world.ts';
import { as, type MembersCompany, membersCompany } from '../../../../../../fixtures/members/members.ts';

let w: MachinesWorld;
let power: FakeLocalPower;
beforeAll(async () => {
  power = fakeLocalPower(boxDriver('running', 'immediately'));
  w = await machinesWorld({}, { local: power.local });
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

/** The app's own port (`testConfig`): both ends of every tunnel. */
const PORT = 9950;
const tunnelTo = (machineId: string) => ({
  machineId,
  target: { provider: 'airia_devbox', ref: BOX_REF },
  remotePort: PORT,
  localPort: PORT,
  running: false,
});
const heldIds = () => power.held().map((tunnel) => tunnel.machineId);

/** The devbox's tunnel as GET machines/:id shows it. */
async function tunnelOf(company: MembersCompany, machineId: string): Promise<MachineView['tunnel']> {
  const res = await as(w, company.owner)('GET', machinesPath(company, `/${machineId}`));
  return (res.body as MachineView).tunnel;
}

const BOX0 = { size: null, hourlyCost: null, rules: null, error: null };

describe("the devboxes' tunnels this server holds", () => {
  it("are held once a box enrolls, every company's in one set, on the server's port", async () => {
    const [a, b] = [await membersCompany(w), await membersCompany(w)];
    const boxA = await enroll(w, a, DEVBOX);
    expect(power.held()).toContainEqual(tunnelTo(boxA.machineId));
    const boxB = await enroll(w, b, DEVBOX);
    expect(heldIds()).toEqual(expect.arrayContaining([boxA.machineId, boxB.machineId]));
    // A Mac is no devbox: it has no tunnel.
    const mac = await enroll(w, a, MAC);
    expect(heldIds()).not.toContain(mac.machineId);
  });

  it('follow the box stopped and started by hand, and its removal', async () => {
    const company = await membersCompany(w);
    const box = await enroll(w, company, DEVBOX);
    const post = (action: string) => as(w, company.owner)('POST', powerPath(company, box.machineId, action));
    expect((await post('/stop')).status).toBe(202);
    expect(heldIds()).not.toContain(box.machineId);
    expect((await post('/start')).status).toBe(202);
    expect(heldIds()).toContain(box.machineId);
    const removed = await as(w, company.owner)('DELETE', machinesPath(company, `/${box.machineId}`));
    expect(removed.status).toBe(204);
    expect(heldIds()).not.toContain(box.machineId);
  });

  it("show the states it reports on the box in GET machines, as this server's, not a runner's", async () => {
    const company = await membersCompany(w);
    const box = await enroll(w, company, DEVBOX);
    expect(await tunnelOf(company, box.machineId)).toBeNull();
    power.report(box.machineId, 'connecting');
    expect(await tunnelOf(company, box.machineId)).toEqual({
      state: 'connecting',
      error: null,
      since: TEST_NOW,
    });
    const error = 'ERROR: (gcloud.compute.ssh) [/usr/bin/ssh] exited with return code [255].';
    power.report(box.machineId, 'down', error);
    expect(await tunnelOf(company, box.machineId)).toMatchObject({ state: 'down', error });
    // A report for a machine it holds no tunnel to is dropped.
    power.report('019a0000-0000-7000-8000-0000000000aa', 'up');
    expect(w.hub.tunnels.report(company.companyId, '019a0000-0000-7000-8000-0000000000aa')).toBeUndefined();
    // A runner that still reports the box's tunnel is not who links it now.
    const mac = await enroll(w, company, MAC);
    await as(w, company.owner)('PATCH', machinesPath(company, `/${box.machineId}`), {
      controllerMachineId: mac.machineId,
    });
    const runner = await connectController(w, mac.runnerKey, boxDriver('running'));
    expect((await runner.frames.next('tunnel.set')).tunnels).toEqual([]);
    runner.send({ type: 'tunnel.state', machineId: box.machineId, state: 'up' });
    await eventually(
      'the runner was heard',
      () => w.hub.tunnels.report(company.companyId, box.machineId)?.reportedBy === mac.machineId,
    );
    expect(await tunnelOf(company, box.machineId)).toBeNull();
  });

  it("follow the scheduler's readings: a stored status that changed is held again at its next step", async () => {
    const company = await membersCompany(w);
    const box = await enroll(w, company, DEVBOX);
    const t = await tenant(w.t.db, company.companyId);
    const scheduler = powerScheduler({
      db: w.t.db,
      hub: w.hub,
      logger: w.deps.logger,
      clock: w.clock,
      control: w.control,
    });
    const checkedAt = w.clock().toISOString();
    await saveState(t, box.machineId, { box: { ...BOX0, checkedAt, status: 'stopped' } });
    await scheduler.step(w.clock());
    expect(heldIds()).not.toContain(box.machineId);
    await saveState(t, box.machineId, { box: { ...BOX0, checkedAt, status: 'starting' } });
    await scheduler.step(w.clock());
    await scheduler.idle();
    expect(heldIds()).toContain(box.machineId);
  });

  it('are all stopped when the control closes (the server shuts down)', async () => {
    const own = fakeLocalPower(boxDriver());
    const control = serverControl({ hub: w.hub, port: PORT, local: own.local });
    await control.close();
    expect(own.closed()).toBe(1);
  });
});
