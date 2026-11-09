import { newId } from '@mwc/shared/ids';
import { TEST_NOW } from '@mwc/testkit';
import type { FakeRunner } from '@mwc/testkit/runner';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { MachineView } from '../../../../../../src/modules/machines/schemas.ts';
import { DEVBOX, enroll, MAC, machinesPath } from '../../../../../fixtures/machines/machines.ts';
import { BOX_REF, boxDriver, connectController } from '../../../../../fixtures/machines/power.ts';
import { eventually, type MachinesWorld, machinesWorld } from '../../../../../fixtures/machines/world.ts';
import { as, type MembersCompany, membersCompany } from '../../../../../fixtures/members/members.ts';

let w: MachinesWorld;
beforeAll(async () => {
  w = await machinesWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

const listed = (body: unknown) => (body as { machines: MachineView[] }).machines;

/** Waits until the server has read every frame `runner` sent so far: a last report for a made-up machine is kept. */
async function caughtUp(runner: FakeRunner, companyId: string): Promise<void> {
  const marker = newId();
  runner.send({ type: 'tunnel.state', machineId: marker, state: 'connecting' });
  await eventually('the server read it all', () => w.hub.tunnels.report(companyId, marker) !== undefined);
}

/** The machines' tunnels as GET machines shows them, by id. */
async function tunnels(company: MembersCompany): Promise<Record<string, MachineView['tunnel']>> {
  const res = await as(w, company.owner)('GET', machinesPath(company));
  return Object.fromEntries(listed(res.body).map((machine) => [machine.id, machine.tunnel]));
}

/** A company's Mac and devbox, the Mac saved as the box's controller. */
async function controlled(company: MembersCompany) {
  const mac = await enroll(w, company, MAC);
  const box = await enroll(w, company, DEVBOX);
  await as(w, company.owner)('PATCH', machinesPath(company, `/${box.machineId}`), {
    controllerMachineId: mac.machineId,
  });
  return { mac, box };
}

describe("the controllers' tunnel states", () => {
  it('show on the devbox in GET machines as its controller reports them, null on other machines and before', async () => {
    const company = await membersCompany(w);
    const { mac, box } = await controlled(company);
    expect(await tunnels(company)).toEqual({ [mac.machineId]: null, [box.machineId]: null });
    const controller = await connectController(w, mac.runnerKey, boxDriver('running'));
    controller.send({ type: 'tunnel.state', machineId: box.machineId, state: 'connecting' });
    await eventually('the report is kept', async () => (await tunnels(company))[box.machineId] !== null);
    expect((await tunnels(company))[box.machineId]).toEqual({
      state: 'connecting',
      error: null,
      since: TEST_NOW,
    });
    w.clock.advance(10_000);
    controller.send({ type: 'tunnel.state', machineId: box.machineId, state: 'up' });
    const upSince = new Date(Date.parse(TEST_NOW) + 10_000).toISOString();
    await eventually('it is up', async () => (await tunnels(company))[box.machineId]?.state === 'up');
    w.clock.advance(60_000);
    controller.send({ type: 'tunnel.state', machineId: box.machineId, state: 'up' });
    const error = 'ERROR: (gcloud.compute.ssh) [/usr/bin/ssh] exited with return code [255].';
    controller.send({ type: 'tunnel.state', machineId: box.machineId, state: 'down', error });
    await eventually('it is down', async () => (await tunnels(company))[box.machineId]?.state === 'down');
    const one = await as(w, company.owner)('GET', machinesPath(company, `/${box.machineId}`));
    expect((one.body as MachineView).tunnel).toEqual({
      state: 'down',
      error,
      since: new Date(Date.parse(upSince) + 60_000).toISOString(),
    });
    expect(listed((await as(w, company.owner)('GET', machinesPath(company))).body)[1]?.tunnel).toBeNull();
  });

  it('keep the time a state began while it repeats', async () => {
    const company = await membersCompany(w);
    const { mac, box } = await controlled(company);
    const controller = await connectController(w, mac.runnerKey, boxDriver('running'));
    controller.send({ type: 'tunnel.state', machineId: box.machineId, state: 'up' });
    await eventually('it is up', async () => (await tunnels(company))[box.machineId]?.state === 'up');
    w.clock.advance(60_000);
    controller.send({ type: 'tunnel.state', machineId: box.machineId, state: 'up' });
    await caughtUp(controller, company.companyId);
    expect((await tunnels(company))[box.machineId]?.since).toBe(TEST_NOW);
  });

  it("ignore a report by a machine that is not the box's controller, or of another company's box", async () => {
    const [a, b] = [await membersCompany(w), await membersCompany(w)];
    const ofA = await controlled(a);
    const ofB = await controlled(b);
    const spare = await enroll(w, a, { ...MAC, name: 'Spare Mac' });
    const stranger = await w.connect(spare.runnerKey);
    stranger.send({ type: 'tunnel.state', machineId: ofA.box.machineId, state: 'up' });
    const controllerA = await connectController(w, ofA.mac.runnerKey, boxDriver('running'));
    controllerA.send({ type: 'tunnel.state', machineId: ofB.box.machineId, state: 'up' });
    await caughtUp(stranger, a.companyId);
    await caughtUp(controllerA, a.companyId);
    expect(w.hub.tunnels.report(a.companyId, ofA.box.machineId)?.reportedBy).toBe(spare.machineId);
    expect((await tunnels(a))[ofA.box.machineId]).toBeNull();
    expect(w.hub.tunnels.report(a.companyId, ofB.box.machineId)?.state).toBe('up');
    expect((await tunnels(b))[ofB.box.machineId]).toBeNull();
  });
});

describe('hub.tunnels.set', () => {
  it('sends a set once per connection, not to a runner that is not connected, and again after a reconnect', async () => {
    const company = await membersCompany(w);
    const { mac, box } = await controlled(company);
    const tunnel = {
      machineId: box.machineId,
      target: { provider: 'airia_devbox' as const, ref: BOX_REF },
      remotePort: 9960,
      localPort: 9960,
    };
    expect(w.hub.tunnels.set(mac.machineId, [tunnel])).toBe(false);
    const controller = await connectController(w, mac.runnerKey, boxDriver('running'));
    await controller.frames.next('tunnel.set');
    expect(w.hub.tunnels.set(mac.machineId, [tunnel])).toBe(true);
    expect(w.hub.tunnels.set(mac.machineId, [{ ...tunnel }])).toBe(false);
    expect((await controller.frames.next('tunnel.set')).tunnels).toEqual([tunnel]);
    await controller.reconnect();
    await controller.frames.next('tunnel.set');
    expect(w.hub.tunnels.set(mac.machineId, [tunnel])).toBe(true);
  });
});
