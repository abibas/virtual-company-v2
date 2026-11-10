import { auditLog } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { TEST_NOW } from '@mwc/testkit';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { COMPOSE_FILE } from '../../../../../src/modules/health/service.ts';
import type { MachineView } from '../../../../../src/modules/machines/schemas.ts';
import { FAILURE_KEPT_MS } from '../../../../../src/modules/machines/service/jobs.ts';
import { REBUILD_TIMEOUT_MS } from '../../../../../src/modules/machines/service/runner/rebuild.ts';
import { fakeDocker, RUNNER_ENV } from '../../../../fixtures/machines/docker.ts';
import { enroll, MAC, machinesPath } from '../../../../fixtures/machines/machines.ts';
import { eventually, type MachinesWorld, machinesWorld } from '../../../../fixtures/machines/world.ts';
import { as, membersCompany } from '../../../../fixtures/members/members.ts';

/** The server rebuilds a container runner itself (MWC_LOCAL_DOCKER), on a Docker host that is a fake. */

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
const UP = ['--profile', 'runner', 'up', '-d', '--build', 'runner-local'];
const COMMAND = `docker compose -p ${PROJECT} -f ${COMPOSE_FILE} --profile runner up -d --build runner-local`;

/** A company with its container runner, connected unless told (saying its container's id unless told). */
async function container(connect: 'with id' | 'old' | 'none' = 'with id') {
  const company = await membersCompany(w);
  const { machineId, runnerKey } = await enroll(w, company, CONTAINER);
  const caps = connect === 'with id' ? { containerId: ID } : {};
  const runner = connect === 'none' ? undefined : await w.connect(runnerKey, { caps });
  const call = as(w, company.owner);
  const path = (rest: string) => machinesPath(company, `/${machineId}${rest}`);
  return {
    company,
    machineId,
    runnerKey,
    runner,
    update: () => call('POST', path('/runner-update')),
    view: async () => ((await call('GET', path(''))).body as MachineView).runner,
  };
}

const ourContainer = (fields: Partial<Parameters<typeof docker.add>[0]> = {}) =>
  docker.add({ id: ID, project: PROJECT, files: COMPOSE_FILE, ...fields });

const audited = async (machineId: string) =>
  (
    await rawDb(w.t.db)
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, machineId), eq(auditLog.action, 'runner_update')))
  ).map((row) => [row.field, row.newValue]);

describe('POST runner-update on a container: this server rebuilds it', () => {
  it('finds it by its id, answers 202 at once, rebuilds it with its limits and settings, then audits it', async () => {
    const m = await container();
    ourContainer();
    docker.composeWill({
      hold: true,
      lines: ['#5 [runtime 2/6] RUN apt-get update', '#9 [bundle 3/3] RUN pnpm install'],
    });
    const res = await m.update();
    expect([res.status, res.body]).toEqual([202, { path: 'docker_rebuild', build: null }]);
    expect(docker.calls.map((call) => call.args.slice(0, 2))).toEqual([
      ['inspect', '--type'],
      ['compose', '-p'],
    ]);
    const [rebuild] = docker.rebuilds();
    const folder = COMPOSE_FILE.slice(0, COMPOSE_FILE.lastIndexOf('/'));
    expect(rebuild?.args).toEqual([
      'compose',
      '-p',
      PROJECT,
      '-f',
      COMPOSE_FILE,
      '--project-directory',
      folder,
      ...UP,
    ]);
    expect(rebuild?.env).toEqual({
      MWC_SERVER_URL: 'http://host.docker.internal:9950',
      MWC_RUNNER_NAME: 'Docker runner',
      MWC_RUNNER_SLOTS: '2',
      MWC_ENROLL_TOKEN: '',
      MWC_RUNNER_CPUS: '2',
      MWC_RUNNER_MEMORY: '4g',
    });
    expect(rebuild?.timeoutMs).toBe(REBUILD_TIMEOUT_MS);
    expect((await m.view()).job).toMatchObject({
      kind: 'runner_update',
      path: 'docker_rebuild',
      progress: '#9 [bundle 3/3] RUN pnpm install',
    });
    expect(await m.update()).toMatchObject({
      status: 409,
      body: {
        error: {
          code: 'machine_busy',
          message: 'The container is being rebuilt: wait for its runner to restart',
        },
      },
    });
    expect(await audited(m.machineId)).toEqual([]);
    docker.finish();
    await eventually('the rebuild is audited', async () => (await audited(m.machineId)).length > 0);
    expect(await audited(m.machineId)).toEqual([['runnerUpdate', 'docker_rebuild']]);
    expect((await m.view()).job).toMatchObject({ path: 'docker_rebuild' });
    await w.disconnectAll();
    await w.connect(m.runnerKey, { caps: { containerId: 'aa11bb22cc33' } });
    await eventually('the new runner ends the job', async () => (await m.view()).job === null);
    expect((await m.view()).updateFailure).toBeNull();
  });

  it("finds an old runner's container by its compose project, and rebuilds one whose runner is offline", async () => {
    const old = await container('old');
    ourContainer();
    expect((await old.update()).status).toBe(202);
    expect(docker.calls.map((call) => call.args[0])).toEqual(['ps', 'inspect', 'compose']);
    expect(docker.calls[0]?.args).toEqual([
      'ps',
      '--all',
      '--filter',
      `label=com.docker.compose.project=${PROJECT}`,
      '--filter',
      'label=com.docker.compose.service=runner-local',
      '--format',
      '{{.ID}}',
    ]);
    await w.disconnectAll();
    docker.calls.length = 0;
    const offline = await container('none');
    expect((await offline.update()).status).toBe(202);
    expect(docker.rebuilds()).toHaveLength(1);
  });

  it('looks up the project when the id names another container, and keeps no limit Docker does not have', async () => {
    const m = await container();
    docker.add({ id: ID, project: 'something-else', files: COMPOSE_FILE });
    docker.add({
      id: 'abcdef012345',
      project: PROJECT,
      files: COMPOSE_FILE,
      nanoCpus: 0,
      memory: 0,
      env: [],
    });
    expect((await m.update()).status).toBe(202);
    expect(docker.rebuilds()[0]?.env).toEqual({ MWC_ENROLL_TOKEN: '' });
  });

  it('is the command to run when no container of it is found, and machine_offline without its runner', async () => {
    const m = await container();
    docker.add({ id: ID, project: PROJECT, files: '/elsewhere/deploy/compose.yml' });
    expect(await m.update()).toMatchObject({
      status: 409,
      body: { error: { code: 'update_unsupported', command: COMMAND } },
    });
    expect(docker.rebuilds()).toEqual([]);
    const offline = await container('none');
    expect(await offline.update()).toMatchObject({
      status: 409,
      body: { error: { code: 'machine_offline' } },
    });
    expect((await m.view()).job).toBeNull();
  });

  it('is a 502 update_failed when Docker does not answer, and releases the machine', async () => {
    const m = await container();
    docker.stop();
    expect(await m.update()).toMatchObject({
      status: 502,
      body: {
        error: {
          code: 'update_failed',
          message:
            'The runner was not updated: Docker did not answer: Cannot connect to the Docker daemon at unix:///var/run/docker.sock',
        },
      },
    });
    expect((await m.view()).job).toBeNull();
  });
});

describe('a rebuild that fails after the answer', () => {
  it('releases the machine and shows why with the command, until the next job or 30 minutes', async () => {
    const m = await container();
    ourContainer();
    docker.composeWill({
      result: {
        ok: false,
        stdout: '',
        lines: [],
        error: 'failed to solve: process "/bin/sh -c pnpm install" did not complete',
      },
    });
    expect((await m.update()).status).toBe(202);
    await eventually('the failure shows', async () => (await m.view()).updateFailure !== null);
    const view = await m.view();
    expect(view.job).toBeNull();
    expect(view.updateFailure).toEqual({
      path: 'docker_rebuild',
      message:
        'The container was not rebuilt: failed to solve: process "/bin/sh -c pnpm install" did not complete',
      command: COMMAND,
      at: TEST_NOW,
    });
    expect(await audited(m.machineId)).toEqual([]);
    w.clock.advance(FAILURE_KEPT_MS);
    expect((await m.view()).updateFailure).toBeNull();
  });

  it('says so when the rebuild stopped unexpectedly, and the next update clears it', async () => {
    const m = await container();
    ourContainer();
    docker.composeWill({ result: 'reject' });
    expect((await m.update()).status).toBe(202);
    await eventually('the failure shows', async () => (await m.view()).updateFailure !== null);
    expect((await m.view()).updateFailure?.message).toBe(
      'The container was not rebuilt: the rebuild stopped unexpectedly',
    );
    docker.composeWill({ result: { ok: true, stdout: '', lines: [] } });
    expect((await m.update()).status).toBe(202);
    expect((await m.view()).updateFailure).toBeNull();
    expect(RUNNER_ENV[0]).toMatch(/^MWC_ENROLL_TOKEN=/);
    expect(JSON.stringify(docker.rebuilds())).not.toContain('usedlongago');
  });
});
