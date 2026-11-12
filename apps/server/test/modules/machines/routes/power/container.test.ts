import { newId } from '@mwc/shared/ids';
import { TEST_NOW } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { COMPOSE_FILE } from '../../../../../src/modules/health/service.ts';
import type { MachinePowerView } from '../../../../../src/modules/machines/schemas/power.ts';
import type { MachineView } from '../../../../../src/modules/machines/schemas.ts';
import type { TerminalSink } from '../../../../../src/modules/machines/service/runner/hub.ts';
import { fakeDocker } from '../../../../fixtures/machines/docker.ts';
import { enroll, MAC, machinesPath } from '../../../../fixtures/machines/machines.ts';
import { eventsOf, powerPath } from '../../../../fixtures/machines/power.ts';
import { eventually, type MachinesWorld, machinesWorld } from '../../../../fixtures/machines/world.ts';
import { addMember, as, membersCompany } from '../../../../fixtures/members/members.ts';

/** Start and Stop of a container runner's container by this server, on a Docker host that is a fake. */

const docker = fakeDocker();
let w: MachinesWorld;
beforeAll(async () => {
  w = await machinesWorld({}, { localDocker: docker.docker });
});
afterEach(async () => {
  docker.finish();
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
  docker.reset();
});
afterAll(() => w.close());

const ID = '22f64abad310';
const CONTAINER = { ...MAC, kind: 'container' as const, name: 'Docker runner', os: 'linux' as const };
const PROJECT = 'mwc-runner-docker-runner';
const COMPOSE = `docker compose -p ${PROJECT} -f ${COMPOSE_FILE} --profile runner`;
const powerOf = (body: unknown) => (body as MachinePowerView).container;

/** A company with its container runner, connected (saying its container's id) unless told. */
async function container(connect: 'with id' | 'none' = 'with id') {
  const company = await membersCompany(w);
  const { machineId, runnerKey } = await enroll(w, company, CONTAINER);
  const runner =
    connect === 'none'
      ? undefined
      : await w.connect(runnerKey, { caps: { containerId: ID, terminal: true, slots: 1 } });
  const owner = as(w, company.owner);
  const path = (rest = '') => powerPath(company, machineId, rest);
  return {
    company,
    machineId,
    runner,
    power: async () => powerOf((await owner('GET', path())).body),
    start: (body?: unknown) => owner('POST', path('/start'), body),
    stop: (body?: unknown) => owner('POST', path('/stop'), body),
    events: () => eventsOf(w.t.db, machineId),
    job: async () =>
      ((await owner('GET', machinesPath(company, `/${machineId}`))).body as MachineView).runner.job,
  };
}

const ours = (fields: Partial<Parameters<typeof docker.add>[0]> = {}) =>
  docker.add({ id: ID, project: PROJECT, files: COMPOSE_FILE, ...fields });

describe("a container runner's power view", () => {
  it("is Docker's state of its container with the commands, for viewers too, and no box", async () => {
    const m = await container();
    ours();
    const viewer = await addMember(w, m.company, 'viewer');
    const res = await as(w, viewer)('GET', powerPath(m.company, m.machineId));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ box: null, canControl: false });
    expect(powerOf(res.body)).toEqual({
      status: 'running',
      docker: true,
      commands: {
        start: `${COMPOSE} start runner-local`,
        stop: `${COMPOSE} stop runner-local`,
        create: `MWC_RUNNER_NAME='Docker runner' MWC_RUNNER_CPUS=2 MWC_RUNNER_MEMORY=4g MWC_RUNNER_SLOTS=1 ${COMPOSE} up -d runner-local`,
      },
      error: null,
    });
    ours({ health: 'starting' });
    expect((await m.power())?.status).toBe('starting');
    ours({ state: 'exited' });
    expect((await m.power())?.status).toBe('stopped');
  });

  it('is missing without a container while its runner is away, running while it is connected', async () => {
    const offline = await container('none');
    expect((await offline.power())?.status).toBe('missing');
    const online = await container();
    expect((await online.power())?.status).toBe('running');
  });

  it("says Docker did not answer, and goes by its runner's link", async () => {
    const m = await container();
    docker.stop();
    expect(await m.power()).toMatchObject({
      status: 'running',
      error: 'Docker did not answer: Cannot connect to the Docker daemon at unix:///var/run/docker.sock',
    });
  });
});

describe('POST power/stop and power/start on a container', () => {
  it('stops it with its grace period and starts it again, each logged with the person', async () => {
    const m = await container();
    ours();
    const stopped = await m.stop();
    expect(stopped.status).toBe(202);
    expect(powerOf(stopped.body)?.status).toBe('stopped');
    expect(docker.powers().map((call) => [call.args, call.timeoutMs])).toEqual([
      [['stop', '-t', '90', ID], 120_000],
    ]);
    expect(docker.stateOf(ID)).toBe('exited');
    await w.disconnectAll();
    const started = await m.start({});
    expect(started.status).toBe(202);
    expect(docker.powers().at(-1)?.args).toEqual(['start', ID]);
    expect(docker.powers().at(-1)?.timeoutMs).toBe(60_000);
    // Its runner is away: found in its compose project, started, then read again for the answer.
    expect(docker.calls.map((call) => call.args[0]).slice(-5)).toEqual([
      'ps',
      'inspect',
      'start',
      'ps',
      'inspect',
    ]);
    expect(docker.stateOf(ID)).toBe('running');
    const events = await m.events();
    expect(events).toHaveLength(2);
    expect(events[0]).toMatch(/^stopped user:\S+: Stopped by hand$/);
    expect(events[1]).toMatch(/^started user:\S+: Started by hand$/);
  });

  it("takes the container's own grace period, and does nothing to a container already there", async () => {
    const m = await container();
    ours({ stopTimeout: 30 });
    expect((await m.start()).status).toBe(202);
    expect((await m.stop()).status).toBe(202);
    ours({ state: 'exited' });
    expect((await m.stop()).status).toBe(202);
    expect(docker.powers().map((call) => call.args)).toEqual([['stop', '-t', '30', ID]]);
    expect((await m.events()).map((line) => line.replace(/user:[^:\s]+/, 'user'))).toEqual([
      'started user: Started by hand: the container was already on',
      'stopped user: Stopped by hand',
      'stopped user: Stopped by hand: the container was already off',
    ]);
  });

  it('refuses a Stop while a terminal is open on it, naming it; force goes ahead', async () => {
    const m = await container();
    ours();
    const sink: TerminalSink = { opened: () => {}, output: () => {}, exit: () => {} };
    const terminal = w.hub.terminal(m.machineId, { sessionId: newId(), cols: 80, rows: 24 }, sink);
    expect(await m.stop()).toMatchObject({
      status: 409,
      body: {
        error: {
          code: 'machine_busy',
          message: '1 terminal is running on it: stop the container once it ends',
        },
      },
    });
    expect(await m.job()).toBeNull();
    expect((await m.stop({ force: 'yes' })).status).toBe(400);
    expect((await m.stop({ force: true })).status).toBe(202);
    expect(docker.powers()).toHaveLength(1);
    terminal?.close();
  });

  it('holds the machine while Docker works: stopping, other jobs wait', async () => {
    const m = await container();
    ours();
    docker.powerWill({ hold: true });
    const pending = m.stop();
    await eventually('docker stop runs', async () => docker.powers().length === 1);
    expect((await m.power())?.status).toBe('stopping');
    expect(await m.job()).toMatchObject({ kind: 'container_power', action: 'stop' });
    const busy = { code: 'machine_busy', message: 'The container is stopping: wait for it to finish' };
    expect(await m.start()).toMatchObject({ status: 409, body: { error: busy } });
    docker.finish();
    expect((await pending).status).toBe(202);
    expect(await m.job()).toBeNull();
  });

  it("is a 502 with Docker's words when its command fails, logged, and releases the machine", async () => {
    const m = await container();
    ours({ state: 'exited' });
    docker.powerWill({
      result: {
        ok: false,
        stdout: '',
        lines: [],
        error: 'Error response from daemon: ports are not available',
      },
    });
    const message = 'Docker did not start the container: Error response from daemon: ports are not available';
    expect(await m.start()).toMatchObject({
      status: 502,
      body: { error: { code: 'power_failed', message, driverCode: 'failed' } },
    });
    expect((await m.events()).map((line) => line.replace(/user:[^:\s]+/, 'user'))).toEqual([
      'failed user: Starting the container failed: Error response from daemon: ports are not available',
    ]);
    expect(await m.job()).toBeNull();
    docker.stop();
    expect(await m.stop()).toMatchObject({
      status: 502,
      body: {
        error: {
          message:
            'Docker did not stop the container: Cannot connect to the Docker daemon at unix:///var/run/docker.sock',
        },
      },
    });
  });

  it('names the command when no container of it is found: create it again, or stop it where it runs', async () => {
    const m = await container('none');
    docker.add({ id: ID, project: PROJECT, files: '/elsewhere/deploy/compose.yml' });
    const start = await m.start();
    expect(start).toMatchObject({ status: 409, body: { error: { code: 'container_missing' } } });
    expect((start.body as { error: { command: string } }).error.command).toBe(
      `MWC_RUNNER_NAME='Docker runner' MWC_RUNNER_CPUS=2 MWC_RUNNER_MEMORY=4g MWC_RUNNER_SLOTS=1 ${COMPOSE} up -d runner-local`,
    );
    expect(await m.stop()).toMatchObject({
      status: 409,
      body: { error: { code: 'container_missing', command: `${COMPOSE} stop runner-local` } },
    });
    expect(docker.powers()).toEqual([]);
    expect(await m.events()).toEqual([]);
  });

  it('is for admins and owners only', async () => {
    const m = await container();
    ours();
    for (const role of ['member', 'viewer'] as const) {
      const person = await addMember(w, m.company, role);
      expect((await as(w, person)('POST', powerPath(m.company, m.machineId, '/stop'))).status).toBe(403);
    }
    const admin = await addMember(w, m.company, 'admin');
    expect((await as(w, admin)('POST', powerPath(m.company, m.machineId, '/stop'))).status).toBe(202);
  });
});

describe('without a Docker CLI of its own', () => {
  let bare: MachinesWorld;
  beforeAll(async () => {
    bare = await machinesWorld();
  });
  afterAll(() => bare.close());

  it('shows its runner link as its state, and answers Start and Stop with the command to run', async () => {
    const company = await membersCompany(bare);
    const { machineId, runnerKey } = await enroll(bare, company, CONTAINER);
    const owner = as(bare, company.owner);
    expect(powerOf((await owner('GET', powerPath(company, machineId))).body)).toMatchObject({
      status: 'unknown',
      docker: false,
    });
    await bare.connect(runnerKey);
    expect(powerOf((await owner('GET', powerPath(company, machineId))).body)?.status).toBe('running');
    expect(await owner('POST', powerPath(company, machineId, '/stop'))).toMatchObject({
      status: 409,
      body: {
        error: {
          code: 'power_unsupported',
          message:
            'This server does not run Docker for container runners. Run this in a Terminal on the computer running Docker to stop it.',
          command: `${COMPOSE} stop runner-local`,
        },
      },
    });
    await bare.disconnectAll();
  });
});
