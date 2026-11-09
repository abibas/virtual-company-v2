import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  claudeVersion,
  defaultName,
  machineFacts,
  machineKind,
  shortHostname,
} from '../../../src/install/enroll/facts.ts';
import { executable, testHost } from '../../fixtures/host.ts';

describe('what a machine says about itself', () => {
  it('is a laptop on macOS, a container with /.dockerenv or MWC_RUNNER_IN_CONTAINER=1, else a VM', () => {
    expect(machineKind(testHost({ platform: 'darwin', files: ['/.dockerenv'] }).host)).toBe('laptop');
    expect(machineKind(testHost({ files: ['/.dockerenv'] }).host)).toBe('container');
    expect(machineKind(testHost({ env: { MWC_RUNNER_IN_CONTAINER: '1' } }).host)).toBe('container');
    expect(machineKind(testHost({ env: { MWC_RUNNER_IN_CONTAINER: '0' } }).host)).toBe('vm');
  });

  it('asks Claude Code its version once when it is on the PATH, and starts nothing when it is not', async () => {
    const none = testHost();
    expect(await claudeVersion(none.host)).toBeNull();
    expect(none.execs).toEqual([]);
    const { host, home, execs } = testHost({
      exec: () => ({ code: 0, stdout: '  2.1.3 (Claude Code)\nextra\n', stderr: '' }),
    });
    const claude = executable(join(home, 'bin'), 'claude');
    expect(await claudeVersion(host)).toBe('2.1.3 (Claude Code)');
    expect(execs).toEqual([{ file: claude, args: ['--version'], env: undefined }]);
  });

  it('has no version when claude fails, prints nothing, or prints too much (cut to 100)', async () => {
    const answers = [
      { code: 1, stdout: '2.1.3', stderr: 'broken' },
      { code: 0, stdout: '\n', stderr: '' },
      { code: 0, stdout: 'x'.repeat(150), stderr: '' },
    ];
    const { host, home } = testHost({ exec: () => answers.shift() });
    executable(join(home, 'bin'), 'claude');
    expect(await claudeVersion(host)).toBeNull();
    expect(await claudeVersion(host)).toBeNull();
    expect(await claudeVersion(host)).toBe('x'.repeat(100));
  });

  it('names a machine after its short host name, the devbox Airia devbox, a container as one', () => {
    expect(shortHostname('Ihors-MacBook-Pro.local')).toBe('Ihors-MacBook-Pro');
    expect(defaultName('laptop', false, 'Ihors-MacBook-Pro.local')).toBe('Ihors-MacBook-Pro');
    expect(defaultName('vm', true, 'dev-ihorherasko')).toBe('Airia devbox');
    expect(defaultName('vm', false, 'build-1')).toBe('build-1');
    expect(defaultName('container', false, '3f2a9c1d0b7e')).toBe('container 3f2a9c1d0b7e');
    expect(defaultName('vm', false, '.local')).toBe('machine');
    expect(defaultName('vm', false, 'h'.repeat(200))).toHaveLength(80);
  });

  it('gathers the kind, system, architecture, host name, user and Claude Code', async () => {
    const { host } = testHost({ platform: 'darwin' });
    expect(await machineFacts(host)).toEqual({
      kind: 'laptop',
      os: 'darwin',
      arch: 'arm64',
      hostname: 'ihors-mac.local',
      unixUser: 'ihor',
      claudeVersion: null,
    });
  });
});
