import { tenant } from '@mwc/db';
import { MACHINE_POWER_ERROR_MESSAGES } from '@mwc/machines-core';
import { TEST_NOW } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { MachineWake, WakeFailure } from '../../../../../src/modules/machines/index.ts';
import type { ContainerPower } from '../../../../../src/modules/machines/service/power/container.ts';
import { readPower, saveState } from '../../../../../src/modules/machines/service/power/store.ts';
import { machineWake } from '../../../../../src/modules/machines/service/power/wake.ts';
import { enroll, MAC } from '../../../../fixtures/machines/machines.ts';
import {
  boxDriver,
  connectController,
  eventsOf,
  macAndBox,
  putPolicy,
} from '../../../../fixtures/machines/power.ts';
import { type MachinesWorld, machinesWorld } from '../../../../fixtures/machines/world.ts';
import { type MembersCompany, membersCompany } from '../../../../fixtures/members/members.ts';

/** Waking a machine for work: a devbox through its controller, a container with this server's Docker. */

let w: MachinesWorld;
beforeAll(async () => {
  w = await machinesWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

const REASON = 'Started for a message to Developer';
const OWNER = (company: MembersCompany) => ({ userId: company.owner.userId, role: 'owner' as const });

/** A container's Start that answers as told, and records its calls. */
function containers(answer: Awaited<ReturnType<ContainerPower['act']>>, docker = true) {
  const calls: string[] = [];
  const power = {
    docker,
    view: async () => {
      throw new Error('not used');
    },
    act: async (_machine: unknown, action: string) => {
      calls.push(action);
      return answer;
    },
  } as unknown as ContainerPower;
  return { power, calls };
}

const STARTED = { ok: true as const, status: 'starting' as const, already: false };

/** The wake on the world, with its failures heard. */
function wakeOn(container = containers(STARTED).power): { wake: MachineWake; failures: WakeFailure[] } {
  const wake = machineWake({
    db: w.t.db,
    hub: w.hub,
    logger: w.deps.logger,
    clock: w.clock,
    control: w.control,
    containers: container,
  });
  const failures: WakeFailure[] = [];
  wake.onFailed((failure) => failures.push(failure));
  return { wake, failures };
}

async function boxScene(
  policy: Parameters<typeof putPolicy>[3] = {},
  status: 'stopped' | 'running' = 'stopped',
) {
  const company = await membersCompany(w);
  const { mac, box } = await macAndBox(w, company);
  const driver = boxDriver(status);
  await connectController(w, mac.runnerKey, driver);
  await putPolicy(w, company, box.machineId, policy);
  const t = await tenant(w.t.db, company.companyId);
  return { company, mac, box, driver, t };
}

describe('waking a devbox', () => {
  it('starts it when its switch for the trigger is on, in the background, logged as auto, and holds it', async () => {
    const s = await boxScene({ autoStartOnMessage: true });
    const { wake } = wakeOn();
    const woken = await wake.wake(s.t, s.box.machineId, { trigger: 'message', reason: REASON });
    expect(woken).toMatchObject({
      ok: true,
      state: 'starting',
      machine: { id: s.box.machineId, name: 'Airia devbox', kind: 'vm', provider: 'airia_devbox' },
    });
    await wake.idle();
    expect(s.driver.calls.map((call) => call.call)).toEqual(['start']);
    expect((await eventsOf(w.t.db, s.box.machineId)).slice(1)).toEqual([
      'held auto: Held for 45 minutes after the last turn',
      `started auto: ${REASON}`,
    ]);
    const { state } = await readPower(s.t, s.box.machineId);
    expect(state).toMatchObject({ lastTurnAt: w.clock().toISOString(), holdKind: 'after_turn' });
    expect(state.box).toMatchObject({ status: 'starting', hourlyCost: 0.268 });
    // Read `starting` a moment ago: a second wake sends nothing.
    expect(await wake.wake(s.t, s.box.machineId, { trigger: 'message', reason: REASON })).toMatchObject({
      state: 'starting',
    });
    await wake.idle();
    expect(s.driver.calls).toHaveLength(1);
  });

  it('refuses with the switch off, saying whether the person may start it, and starts it as theirs when they ask', async () => {
    const s = await boxScene({ autoStartOnMessage: true });
    const { wake } = wakeOn();
    const work = await wake.wake(s.t, s.box.machineId, {
      trigger: 'work',
      reason: 'Started for T-3 · Develop',
    });
    expect(work).toMatchObject({ ok: false, state: 'switch_off', canStart: false });
    const viewer = { userId: s.company.owner.userId, role: 'viewer' as const };
    const asked = { trigger: 'work' as const, reason: REASON, asked: true };
    expect(await wake.wake(s.t, s.box.machineId, { ...asked, person: viewer })).toMatchObject({
      state: 'switch_off',
      canStart: false,
    });
    expect(await wake.wake(s.t, s.box.machineId, { ...asked, person: OWNER(s.company) })).toMatchObject({
      ok: true,
      state: 'starting',
    });
    await wake.idle();
    expect((await eventsOf(w.t.db, s.box.machineId)).at(-1)).toBe(
      `started user:${s.company.owner.userId}: ${REASON}`,
    );
  });

  it('says a box that was on already, and sends nothing while its start runs or it was read up lately', async () => {
    const s = await boxScene({ autoStartOnWork: true }, 'running');
    const { wake } = wakeOn();
    const request = { trigger: 'work' as const, reason: REASON };
    await wake.wake(s.t, s.box.machineId, request);
    expect(await wake.wake(s.t, s.box.machineId, request)).toMatchObject({ ok: true, state: 'starting' });
    await wake.idle();
    expect(s.driver.calls.map((call) => call.call)).toEqual(['start']);
    expect((await eventsOf(w.t.db, s.box.machineId)).at(-1)).toBe(
      `started auto: ${REASON}: the box was already on`,
    );
    await saveState(s.t, s.box.machineId, { box: null });
    await wake.wake(s.t, s.box.machineId, request);
    await wake.idle();
    expect(s.driver.calls.map((call) => call.call)).toEqual(['start', 'start']);
  });

  it('logs a start that fails and tells the listeners, in words', async () => {
    const s = await boxScene({ autoStartOnWork: true });
    s.driver.failNext('start', 'stockout_or_quota');
    const { wake, failures } = wakeOn();
    await wake.wake(s.t, s.box.machineId, { trigger: 'work', reason: REASON });
    await wake.idle();
    const why = MACHINE_POWER_ERROR_MESSAGES.stockout_or_quota;
    expect((await eventsOf(w.t.db, s.box.machineId)).at(-1)).toBe(
      `failed auto: ${REASON}, but the start failed: ${why}`,
    );
    expect(failures).toEqual([
      {
        companyId: s.company.companyId,
        machineId: s.box.machineId,
        message: `Airia devbox did not start: ${why}`,
      },
    ]);
    expect((await readPower(s.t, s.box.machineId)).state.box?.error?.code).toBe('stockout_or_quota');
  });

  it('cannot start a box whose controller is away, and says up for a connected runner', async () => {
    const company = await membersCompany(w);
    const { box } = await macAndBox(w, company);
    await putPolicy(w, company, box.machineId, { autoStartOnWork: true });
    const t = await tenant(w.t.db, company.companyId);
    const { wake } = wakeOn();
    expect(await wake.wake(t, box.machineId, { trigger: 'work', reason: REASON })).toMatchObject({
      ok: false,
      state: 'cannot',
      message: expect.stringMatching(
        /^Airia devbox is stopped and cannot be started now: No connected machine can power this box/,
      ),
    });
    await w.connect(box.runnerKey);
    expect(await wake.wake(t, box.machineId, { trigger: 'work', reason: REASON })).toMatchObject({
      ok: true,
      state: 'up',
    });
    expect(await wake.wake(t, company.companyId, { trigger: 'work', reason: REASON })).toMatchObject({
      ok: false,
      code: 'machine_not_found',
    });
  });

  it('tells the listeners of a start that threw, and logs a listener that throws', async () => {
    const s = await boxScene({ autoStartOnWork: true });
    const control = {
      ...w.control,
      resolve: async () => ({
        ok: true as const,
        machineId: null,
        run: () => Promise.reject(new Error('broken')),
      }),
    };
    const wake = machineWake({
      db: w.t.db,
      hub: w.hub,
      logger: w.deps.logger,
      clock: w.clock,
      control,
      containers: containers(STARTED).power,
    });
    const failures: WakeFailure[] = [];
    wake.onFailed(() => {
      throw new Error('a listener broke');
    });
    const stop = wake.onFailed((failure) => failures.push(failure));
    await wake.wake(s.t, s.box.machineId, { trigger: 'work', reason: REASON });
    await wake.idle();
    expect(failures.map((failure) => failure.message)).toEqual([
      'Airia devbox did not start: the server failed',
    ]);
    const said = (msg: string) =>
      w.logs.filter((line) => line.msg === msg && line.machineId === s.box.machineId);
    expect(said('power: a wake could not start its machine')).toHaveLength(1);
    expect(said('power: a wake listener failed')).toHaveLength(1);
    stop();
  });
});

describe('waking other machines', () => {
  it('starts a container with this server’s Docker, and logs what Docker answered', async () => {
    const company = await membersCompany(w);
    const { machineId } = await enroll(w, company, { ...MAC, name: 'Docker runner', kind: 'container' });
    await putPolicy(w, company, machineId, { autoStartOnMessage: true });
    const t = await tenant(w.t.db, company.companyId);
    const ok = containers({ ...STARTED, already: true });
    const { wake } = wakeOn(ok.power);
    expect(await wake.wake(t, machineId, { trigger: 'message', reason: REASON })).toMatchObject({
      state: 'starting',
    });
    await wake.idle();
    expect(ok.calls).toEqual(['start']);
    expect(await eventsOf(w.t.db, machineId)).toContain(
      `started auto: ${REASON}: the container was already on`,
    );
    const failure = {
      ok: false,
      status: 502,
      code: 'power_failed',
      message: 'Docker failed',
      driverCode: 'failed',
      detail: 'no space left',
    } as const;
    const broken = wakeOn(containers(failure).power);
    await broken.wake.wake(t, machineId, { trigger: 'message', reason: REASON });
    await broken.wake.idle();
    expect(broken.failures.map((f) => f.message)).toEqual(['Docker runner did not start: no space left']);
    const busy = wakeOn(containers({ ok: false, status: 409, code: 'machine_busy', message: 'Busy' }).power);
    await busy.wake.wake(t, machineId, { trigger: 'message', reason: REASON });
    await busy.wake.idle();
    expect(busy.failures.map((f) => f.message)).toEqual(['Docker runner did not start: Busy']);
    const byHand = wakeOn(containers(STARTED, false).power);
    expect(await byHand.wake.wake(t, machineId, { trigger: 'message', reason: REASON })).toMatchObject({
      state: 'cannot',
      message: 'Docker runner is stopped: run its start command, on the Machines page',
    });
  });

  it('cannot start a laptop or a machine without power control', async () => {
    const company = await membersCompany(w);
    const mac = await enroll(w, company);
    const other = await enroll(w, company, { ...MAC, name: 'Build box', kind: 'vm' });
    const t = await tenant(w.t.db, company.companyId);
    const { wake } = wakeOn();
    expect(await wake.wake(t, mac.machineId, { trigger: 'message', reason: REASON })).toMatchObject({
      state: 'cannot',
      message: 'This Mac is asleep: wake it, and its runner reconnects on its own',
    });
    expect(await wake.wake(t, other.machineId, { trigger: 'message', reason: REASON })).toMatchObject({
      state: 'cannot',
      message: 'Build box is offline: start its runner there',
    });
  });
});
