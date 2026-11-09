import { describe, expect, it } from 'vitest';
import {
  ContainerRunnerSettings,
  containerRunnerCommand,
  containerRunnerProject,
  containerRunnerSlug,
  containerServerUrl,
  DEFAULT_CONTAINER_RUNNER,
  isLoopback,
  shellQuote,
  shellWord,
} from '../src/container-runner.ts';

const TOKEN = `mwc_et_${'Ab12'.repeat(8)}`;
const COMPOSE = '/Users/ihor/v2/deploy/compose.yml';

describe('container runner settings', () => {
  it('defaults to "Docker runner", 2 CPUs, 4 GB and 2 runs at once, within the ranges', () => {
    expect(DEFAULT_CONTAINER_RUNNER).toEqual({ name: 'Docker runner', cpus: 2, memoryGb: 4, slots: 2 });
    expect(ContainerRunnerSettings.parse(DEFAULT_CONTAINER_RUNNER)).toEqual(DEFAULT_CONTAINER_RUNNER);
  });

  it('takes half CPUs and refuses values out of range', () => {
    const ok = (patch: object) =>
      ContainerRunnerSettings.safeParse({ ...DEFAULT_CONTAINER_RUNNER, ...patch }).success;
    expect(ok({ cpus: 0.5 })).toBe(true);
    expect(ok({ cpus: 16 })).toBe(true);
    expect(ok({ cpus: 0.4 })).toBe(false);
    expect(ok({ cpus: 17 })).toBe(false);
    expect(ok({ memoryGb: 0 })).toBe(false);
    expect(ok({ memoryGb: 65 })).toBe(false);
    expect(ok({ memoryGb: 1.5 })).toBe(false);
    expect(ok({ slots: 0 })).toBe(false);
    expect(ok({ slots: 9 })).toBe(false);
    expect(ok({ name: '   ' })).toBe(false);
  });
});

describe('the compose project', () => {
  it('is mwc-runner-<slug>, the slug lowercase a-z, 0-9 and single dashes', () => {
    expect(containerRunnerSlug('Docker runner')).toBe('docker-runner');
    expect(containerRunnerSlug("  Ihor's  Café #2 ")).toBe('ihor-s-cafe-2');
    expect(containerRunnerSlug('Привіт')).toBe('runner');
    expect(containerRunnerSlug(`${'a'.repeat(39)} b`)).toBe('a'.repeat(39));
    expect(containerRunnerProject('Docker runner')).toBe('mwc-runner-docker-runner');
  });
});

describe('shell words', () => {
  it('quotes in single quotes, a quote inside closed and escaped', () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    expect(shellWord('/a/b-c/compose.yml')).toBe('/a/b-c/compose.yml');
    expect(shellWord('/Users/me/My Repo/compose.yml')).toBe(`'/Users/me/My Repo/compose.yml'`);
  });
});

describe('the server address of a container', () => {
  it('turns a loopback host into host.docker.internal and keeps others', () => {
    expect(isLoopback('http://127.0.0.2:1')).toBe(true);
    expect(isLoopback('https://corp.example.com')).toBe(false);
    expect(containerServerUrl('http://localhost:9950')).toBe('http://host.docker.internal:9950');
    expect(containerServerUrl('http://127.0.0.1:9960/')).toBe('http://host.docker.internal:9960');
    expect(containerServerUrl('https://corp.example.com')).toBe('https://corp.example.com');
  });
});

describe('the command', () => {
  it('names the token, the name, the limits, its own project and the absolute compose file', () => {
    expect(containerRunnerCommand({ ...DEFAULT_CONTAINER_RUNNER, token: TOKEN, composeFile: COMPOSE })).toBe(
      `MWC_ENROLL_TOKEN=${TOKEN} MWC_RUNNER_NAME='Docker runner' MWC_RUNNER_CPUS=2 MWC_RUNNER_MEMORY=4g ` +
        `MWC_RUNNER_SLOTS=2 docker compose -p mwc-runner-docker-runner -f ${COMPOSE} --profile runner up -d runner-local`,
    );
  });

  it('keeps the relative file without one, quotes the name, and tells the server only when the default misses it', () => {
    const command = containerRunnerCommand({
      name: " Ihor's box ",
      cpus: 1.5,
      memoryGb: 8,
      slots: 1,
      token: TOKEN,
      composeFile: null,
      server: 'http://localhost:9963',
    });
    expect(command).toBe(
      `MWC_SERVER_URL=http://host.docker.internal:9963 MWC_ENROLL_TOKEN=${TOKEN} MWC_RUNNER_NAME='Ihor'\\''s box' ` +
        'MWC_RUNNER_CPUS=1.5 MWC_RUNNER_MEMORY=8g MWC_RUNNER_SLOTS=1 docker compose -p mwc-runner-ihor-s-box ' +
        '-f deploy/compose.yml --profile runner up -d runner-local',
    );
    const local = {
      ...DEFAULT_CONTAINER_RUNNER,
      token: TOKEN,
      composeFile: null,
      server: 'http://localhost:9950',
    };
    expect(containerRunnerCommand(local)).not.toContain('MWC_SERVER_URL');
  });
});
