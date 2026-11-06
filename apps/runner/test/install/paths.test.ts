import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findOnPath,
  installedBundle,
  launchdPlistPath,
  runnerDataDir,
  serviceEnv,
  servicePath,
  serviceSpec,
  systemdUnitPath,
} from '../../src/install/paths.ts';
import { executable, NODE, testHost } from '../fixtures/host.ts';

describe('where an installed runner lives', () => {
  it('keeps the bundle in ~/.local/share/mwc-runner, or under XDG_DATA_HOME', () => {
    expect(runnerDataDir({}, '/home/ihor')).toBe('/home/ihor/.local/share/mwc-runner');
    expect(installedBundle({}, '/home/ihor')).toBe('/home/ihor/.local/share/mwc-runner/runner.mjs');
    expect(installedBundle({ XDG_DATA_HOME: '/data' }, '/home/ihor')).toBe('/data/mwc-runner/runner.mjs');
  });

  it("puts the launchd agent in LaunchAgents and the systemd unit in the user's systemd folder", () => {
    expect(launchdPlistPath('/Users/ihor')).toBe('/Users/ihor/Library/LaunchAgents/com.mwc.runner.plist');
    expect(systemdUnitPath({}, '/home/ihor')).toBe('/home/ihor/.config/systemd/user/mwc-runner.service');
    expect(systemdUnitPath({ XDG_CONFIG_HOME: '/cfg' }, '/home/ihor')).toBe(
      '/cfg/systemd/user/mwc-runner.service',
    );
  });
});

describe("the service's environment", () => {
  it('finds a program in the first absolute folder of PATH that has it', () => {
    const { home } = testHost();
    const first = join(home, 'one');
    const second = join(home, 'two');
    executable(second, 'claude');
    const isExecutable = (path: string) => path === join(second, 'claude');
    expect(findOnPath('claude', `relative:${first}::${second}`, isExecutable)).toBe(join(second, 'claude'));
    expect(findOnPath('claude', undefined, isExecutable)).toBeUndefined();
    expect(findOnPath('gcloud', `${first}:${second}`, isExecutable)).toBeUndefined();
  });

  it("has a short PATH: Node's folder, the folders of the tools found on the installer's PATH, the system's", () => {
    const { host, home } = testHost();
    const brew = join(home, 'brew');
    const local = join(home, '.local', 'bin');
    const airia = join(home, 'airia cli', 'bin');
    executable(local, 'claude');
    executable(brew, 'git');
    executable(brew, 'gh');
    executable(airia, 'airia');
    const env = { ...host.env, PATH: [local, brew, airia, join(home, 'empty'), '/usr/bin'].join(':') };
    expect(servicePath({ ...host, env })).toBe(
      ['/opt/node/bin', local, brew, airia, '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(
        ':',
      ),
    );
  });

  it("passes on where the files are when the installer was told, and the service manager's own variables", () => {
    const { host } = testHost({
      env: { MWC_RUNNER_CONFIG: '/etc/mwc/runner.json', MWC_RUNNER_HOLD: '', XDG_STATE_HOME: '/state' },
    });
    const env = serviceEnv(host, [['MWC_RUNNER_SERVICE', 'launchd']]);
    expect(env.map(([name]) => name)).toEqual([
      'PATH',
      'MWC_RUNNER_CONFIG',
      'XDG_STATE_HOME',
      'MWC_RUNNER_SERVICE',
    ]);
    expect(env[1]).toEqual(['MWC_RUNNER_CONFIG', '/etc/mwc/runner.json']);
  });

  it('runs the installed bundle with the Node that installed it, in the home folder', () => {
    const { host, home } = testHost();
    expect(serviceSpec(host)).toEqual({
      node: NODE,
      bundle: join(home, '.local/share/mwc-runner/runner.mjs'),
      env: [['PATH', '/opt/node/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin']],
      home,
    });
  });
});
