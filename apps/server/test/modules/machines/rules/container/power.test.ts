import { describe, expect, it } from 'vitest';
import {
  containerCommands,
  containerMissing,
  containerStatus,
  graceOf,
  powerByHand,
  powerCommand,
  START_TIMEOUT_MS,
  STOP_GRACE_S,
} from '../../../../../src/modules/machines/rules/container/power.ts';
import { runnerContainerOf } from '../../../../../src/modules/machines/rules/container.ts';
import { inspectJson } from '../../../../fixtures/machines/docker.ts';

const FILE = '/Users/ihor/v2/deploy/compose.yml';
const RECORDED = { id: '22f64abad310', project: 'mwc-runner-docker-runner', files: FILE };
const COMPOSE = `docker compose -p mwc-runner-docker-runner -f ${FILE} --profile runner`;

/** The container runner a recorded `docker inspect` answer describes. */
const recorded = (fields: Partial<Parameters<typeof inspectJson>[0]> = {}) => {
  const container = runnerContainerOf(inspectJson({ ...RECORDED, ...fields }), FILE);
  if (container === undefined) throw new Error('not a container runner');
  return container;
};

describe("a container's power status from Docker's state", () => {
  it('reads running, starting until its health check passes, and stopped once it exited', () => {
    expect(recorded()).toMatchObject({ state: 'running', health: 'healthy', stopTimeout: 90 });
    expect(containerStatus(recorded())).toBe('running');
    expect(containerStatus(recorded({ health: 'starting' }))).toBe('starting');
    expect(containerStatus(recorded({ health: null }))).toBe('running');
    const exited = recorded({ state: 'exited' });
    expect(exited).toMatchObject({ state: 'exited', health: null });
    expect(containerStatus(exited)).toBe('stopped');
  });

  it('maps the other states, and a state Docker did not print is unknown', () => {
    const of = (state: string) => containerStatus({ state, health: null });
    expect([of('created'), of('restarting'), of('removing'), of('paused'), of('dead')]).toEqual([
      'stopped',
      'starting',
      'stopping',
      'unknown',
      'unknown',
    ]);
    const bare = JSON.stringify([
      {
        Id: 'ab'.repeat(32),
        Config: {
          Labels: {
            'com.docker.compose.project': 'mwc-runner-a',
            'com.docker.compose.service': 'runner-local',
            'com.docker.compose.project.config_files': '/srv/a.yml',
          },
        },
        HostConfig: {},
      },
    ]);
    expect(runnerContainerOf(bare, null)).toMatchObject({
      state: 'unknown',
      health: null,
      stopTimeout: null,
    });
  });
});

describe('the docker commands this server runs', () => {
  it("stops with the container's own grace period plus a margin, else compose's 90 s", () => {
    expect(powerCommand(recorded(), 'stop')).toEqual({
      args: ['stop', '-t', '90', '22f64abad310'],
      timeoutMs: 120_000,
    });
    expect(powerCommand(recorded({ stopTimeout: 15 }), 'stop').args).toEqual([
      'stop',
      '-t',
      '15',
      '22f64abad310',
    ]);
    expect(graceOf({ stopTimeout: null })).toBe(STOP_GRACE_S);
    expect(graceOf({ stopTimeout: 0 })).toBe(STOP_GRACE_S);
  });

  it('starts the existing container by its id', () => {
    expect(powerCommand(recorded(), 'start')).toEqual({
      args: ['start', '22f64abad310'],
      timeoutMs: START_TIMEOUT_MS,
    });
  });
});

describe('the commands a person runs instead', () => {
  it("are compose's start and stop in its project, and a create at the default limits with its name and runs", () => {
    const commands = containerCommands({ name: "Ihor's runner", slots: 3 }, FILE);
    const project = `docker compose -p mwc-runner-ihor-s-runner -f ${FILE} --profile runner`;
    expect(commands).toEqual({
      start: `${project} start runner-local`,
      stop: `${project} stop runner-local`,
      create: `MWC_RUNNER_NAME='Ihor'\\''s runner' MWC_RUNNER_CPUS=2 MWC_RUNNER_MEMORY=4g MWC_RUNNER_SLOTS=3 ${project} up -d runner-local`,
    });
  });

  it('name the relative compose file in production, and at least one run at once', () => {
    const commands = containerCommands({ name: 'Docker runner', slots: 0 }, null);
    expect(commands.start).toBe(
      'docker compose -p mwc-runner-docker-runner -f deploy/compose.yml --profile runner start runner-local',
    );
    expect(commands.create).toContain('MWC_RUNNER_SLOTS=1 ');
  });

  it('come with the refusals: no Docker here, or no container of it', () => {
    const commands = containerCommands({ name: 'Docker runner', slots: 2 }, FILE);
    expect(powerByHand('start', commands, FILE)).toEqual({
      ok: false,
      status: 409,
      code: 'power_unsupported',
      message:
        'This server does not run Docker for container runners. Run this in a Terminal on the computer running Docker to start it.',
      command: `${COMPOSE} start runner-local`,
    });
    expect(
      powerByHand('stop', containerCommands({ name: 'Docker runner', slots: 2 }, null), null).message,
    ).toBe(
      'This server does not run Docker for container runners. Run this in the repository folder to stop it.',
    );
    const machine = { name: 'Docker runner' };
    expect(containerMissing('start', machine, commands)).toMatchObject({
      code: 'container_missing',
      command: commands.create,
      message: expect.stringMatching(
        /^No container of this runner was found in the compose project mwc-runner-docker-runner\. This creates it again/,
      ),
    });
    expect(containerMissing('stop', machine, commands)).toMatchObject({
      code: 'container_missing',
      command: `${COMPOSE} stop runner-local`,
      message: expect.stringContaining("started from this server's compose file"),
    });
  });
});
