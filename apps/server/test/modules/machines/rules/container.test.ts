import { describe, expect, it } from 'vitest';
import {
  cpusValue,
  idsOf,
  inspectArgs,
  memoryValue,
  projectArgs,
  rebuildCommand,
  runnerContainerOf,
} from '../../../../src/modules/machines/rules/container.ts';
import { inspectJson } from '../../../fixtures/machines/docker.ts';

const FILE = '/Users/ihor/v2/deploy/compose.yml';
const RECORDED = { id: '22f64abad310', project: 'mwc-runner-docker-runner', files: FILE };

describe("a container runner from docker inspect's answer", () => {
  it('reads its id, project, files, folder, limits and the three settings, nothing else from its environment', () => {
    const container = runnerContainerOf(inspectJson(RECORDED), FILE);
    expect(container).toEqual({
      id: '22f64abad310',
      project: 'mwc-runner-docker-runner',
      files: [FILE],
      folder: '/Users/ihor/v2/deploy',
      nanoCpus: 2_000_000_000,
      memory: 4_294_967_296,
      settings: {
        MWC_RUNNER_NAME: 'Docker runner',
        MWC_RUNNER_SLOTS: '2',
        MWC_SERVER_URL: 'http://host.docker.internal:9950',
      },
    });
    expect(JSON.stringify(container)).not.toContain('mwc_et_');
  });

  it("takes any absolute compose files when the server doesn't know its own, and no limits or labels as none", () => {
    const json = JSON.stringify([
      {
        Id: 'ab'.repeat(32),
        Config: {
          Labels: {
            'com.docker.compose.project': 'mwc-runner-a',
            'com.docker.compose.service': 'runner-local',
            'com.docker.compose.project.config_files': '/srv/a.yml,/srv/b.yml',
          },
          Env: null,
        },
        HostConfig: {},
      },
    ]);
    expect(runnerContainerOf(json, null)).toMatchObject({
      files: ['/srv/a.yml', '/srv/b.yml'],
      folder: null,
      nanoCpus: 0,
      memory: 0,
      settings: {},
    });
    expect(runnerContainerOf(json, '/srv/a.yml')).toBeUndefined();
  });

  it('is none for another service, a project outside the runners, other or relative files, or no JSON', () => {
    expect(runnerContainerOf(inspectJson({ ...RECORDED, service: 'postgres' }), FILE)).toBeUndefined();
    expect(runnerContainerOf(inspectJson({ ...RECORDED, project: 'mwc-v2' }), FILE)).toBeUndefined();
    expect(runnerContainerOf(inspectJson({ ...RECORDED, project: 'mwc-runner--x' }), FILE)).toBeUndefined();
    expect(
      runnerContainerOf(inspectJson({ ...RECORDED, files: '/other/compose.yml' }), FILE),
    ).toBeUndefined();
    expect(
      runnerContainerOf(inspectJson({ ...RECORDED, files: 'deploy/compose.yml' }), null),
    ).toBeUndefined();
    expect(runnerContainerOf(inspectJson({ ...RECORDED, files: '' }), null)).toBeUndefined();
    expect(runnerContainerOf(inspectJson({ ...RECORDED, folder: 'deploy' }), FILE)).toBeUndefined();
    const unlabelled = JSON.stringify([{ Id: 'ab'.repeat(32), Config: {}, HostConfig: {} }]);
    expect(runnerContainerOf(unlabelled, null)).toBeUndefined();
    expect(runnerContainerOf('[]', FILE)).toBeUndefined();
    expect(runnerContainerOf('Error: No such container', FILE)).toBeUndefined();
  });
});

describe('the docker commands', () => {
  it('inspect one container, and list a project’s runner containers by their labels', () => {
    expect(inspectArgs('22f64abad310')).toEqual(['inspect', '--type', 'container', '22f64abad310']);
    expect(projectArgs('mwc-runner-docker-runner')).toContain(
      'label=com.docker.compose.project=mwc-runner-docker-runner',
    );
    expect(idsOf('22f64abad310\n  abcdef012345 \nWARNING: something\n\n')).toEqual([
      '22f64abad310',
      'abcdef012345',
    ]);
  });

  it('say the limits as compose reads them', () => {
    expect([cpusValue(2_000_000_000), cpusValue(1_500_000_000), cpusValue(0)]).toEqual([
      '2',
      '1.5',
      undefined,
    ]);
    expect([
      memoryValue(4 * 1024 ** 3),
      memoryValue(1536 * 1024 ** 2),
      memoryValue(1000),
      memoryValue(0),
    ]).toEqual(['4g', '1536m', '1000b', undefined]);
  });

  it('rebuild it in its project from its files and folder, keeping its settings and limits, with no token', () => {
    const container = runnerContainerOf(inspectJson(RECORDED), FILE);
    if (container === undefined) throw new Error('the recorded container is a runner');
    expect(rebuildCommand(container)).toEqual({
      args: [
        'compose',
        '-p',
        'mwc-runner-docker-runner',
        '-f',
        FILE,
        '--project-directory',
        '/Users/ihor/v2/deploy',
        '--profile',
        'runner',
        'up',
        '-d',
        '--build',
        'runner-local',
      ],
      env: {
        MWC_RUNNER_NAME: 'Docker runner',
        MWC_RUNNER_SLOTS: '2',
        MWC_SERVER_URL: 'http://host.docker.internal:9950',
        MWC_ENROLL_TOKEN: '',
        MWC_RUNNER_CPUS: '2',
        MWC_RUNNER_MEMORY: '4g',
      },
    });
    expect(rebuildCommand({ ...container, folder: null }).args).not.toContain('--project-directory');
  });
});
