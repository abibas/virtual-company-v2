import { ConfigError } from '@mwc/shared/config';
import { captureLogger } from '@mwc/testkit';
import { describe, expect, it } from 'vitest';
import {
  type DockerHost,
  dockerEnv,
  findDocker,
  localDockerFromConfig,
  nodeDockerHost,
} from '../../../../src/platform/processes/docker/local.ts';
import { fakeDockerSpawn, manualTimers } from '../../../fixtures/platform/processes.ts';

const DESKTOP = '/Applications/Docker.app/Contents/Resources/bin/docker';

/** A computer with `docker` at these paths, its processes fakes. */
function computer(
  dockers: readonly string[],
  env: Record<string, string> = { PATH: '/usr/bin:/bin', HOME: '/Users/ihor' },
) {
  const fake = fakeDockerSpawn();
  const host: DockerHost = {
    env,
    exists: (path) => dockers.includes(path),
    spawn: fake.spawn,
    killGroup: fake.killGroup,
    timers: manualTimers().timers,
  };
  return { host, fake };
}

const DEV = { NODE_ENV: 'development' as const, MWC_LOCAL_DOCKER: 'auto' as const };

describe('the docker CLI the server finds', () => {
  it("takes the PATH's absolute folders first, then the usual ones, and starts nothing to look", () => {
    const env = { PATH: 'relative:/opt/tools/bin:/usr/bin' };
    expect(findDocker({ env, exists: (path) => path === '/opt/tools/bin/docker' })).toBe(
      '/opt/tools/bin/docker',
    );
    expect(findDocker({ env: {}, exists: (path) => path === DESKTOP })).toBe(DESKTOP);
    expect(
      findDocker({ env: { PATH: 'docker' }, exists: (path) => path === 'docker/docker' }),
    ).toBeUndefined();
  });

  it('gives a command only the variables Docker reads, its folder first on the PATH, then its own', () => {
    const env = {
      PATH: '/usr/bin',
      HOME: '/Users/ihor',
      DOCKER_CONTEXT: 'desktop-linux',
      MWC_MASTER_KEY: 'secret',
    };
    expect(dockerEnv(env, DESKTOP, { MWC_RUNNER_NAME: 'Docker runner' })).toEqual({
      HOME: '/Users/ihor',
      DOCKER_CONTEXT: 'desktop-linux',
      PATH: '/Applications/Docker.app/Contents/Resources/bin:/usr/bin',
      MWC_RUNNER_NAME: 'Docker runner',
    });
    expect(dockerEnv({}, '/usr/local/bin/docker').PATH).toBe(
      '/usr/local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
    );
  });

  it('this computer is node itself, starting nothing until asked', () => {
    const host = nodeDockerHost({ PATH: '/nowhere' });
    expect(host.env.PATH).toBe('/nowhere');
    expect(host.exists('/definitely/not/here')).toBe(false);
    expect(() => host.killGroup(2 ** 22, 'SIGTERM')).not.toThrow();
    const handle = host.timers.setTimeout(() => {}, 60_000);
    host.timers.clearTimeout(handle);
  });
});

describe('MWC_LOCAL_DOCKER', () => {
  it('auto: used in development when docker is found, and runs it with its environment', async () => {
    const { host, fake } = computer(['/usr/local/bin/docker']);
    const { logger, lines } = captureLogger();
    const docker = localDockerFromConfig(DEV, logger, host);
    expect(docker?.path).toBe('/usr/local/bin/docker');
    expect(lines.at(-1)?.msg).toBe('docker: this server rebuilds, starts and stops container runners itself');
    const heard: string[] = [];
    const ran = docker?.run(['ps'], { timeoutMs: 1000, env: { X: '1' }, onLine: (line) => heard.push(line) });
    fake.stdout.emit('data', 'abc\n');
    fake.child.emit('close', 0, null);
    expect(await ran).toMatchObject({ ok: true, stdout: 'abc\n' });
    expect(heard).toEqual(['abc']);
    expect(fake.spawned[0]?.options.env).toEqual({
      HOME: '/Users/ihor',
      PATH: '/usr/local/bin:/usr/bin:/bin',
      X: '1',
    });
    const quiet = docker?.run(['ps'], { timeoutMs: 1000 });
    fake.child.emit('close', 0, null);
    expect((await quiet)?.ok).toBe(true);
  });

  it('auto: not outside development, nor without docker; off: never', () => {
    const { host } = computer(['/usr/local/bin/docker']);
    const { logger, lines } = captureLogger();
    expect(localDockerFromConfig({ ...DEV, NODE_ENV: 'test' }, logger, host)).toBeUndefined();
    expect(localDockerFromConfig({ ...DEV, NODE_ENV: 'production' }, logger, host)).toBeUndefined();
    expect(localDockerFromConfig({ ...DEV, MWC_LOCAL_DOCKER: 'off' }, logger, host)).toBeUndefined();
    expect(localDockerFromConfig(DEV, logger, computer([]).host)).toBeUndefined();
    expect(lines.map((line) => line.msg)).toEqual([
      'docker: not used for container runners; container runners are updated, started and stopped with the commands the card shows',
      'docker: not used for container runners; container runners are updated, started and stopped with the commands the card shows',
      'docker: not used for container runners; container runners are updated, started and stopped with the commands the card shows',
      expect.stringMatching(/^docker: not found on the PATH or in \/usr\/local\/bin, /),
    ]);
  });

  it('on: used whenever docker is found, even in production, and stops the start without it', () => {
    const on = { NODE_ENV: 'production' as const, MWC_LOCAL_DOCKER: 'on' as const };
    const { logger } = captureLogger();
    expect(localDockerFromConfig(on, logger, computer([DESKTOP]).host)?.path).toBe(DESKTOP);
    expect(() => localDockerFromConfig(on, logger, computer([]).host)).toThrow(ConfigError);
    expect(() => localDockerFromConfig(on, logger, computer([]).host)).toThrow(/MWC_LOCAL_DOCKER/);
  });
});
