import { describe, expect, it } from 'vitest';
import { CommandError, failure, homeOf, unixUser } from '../../src/install/host.ts';
import { testHost } from '../fixtures/host.ts';

describe('the host', () => {
  it('names the Unix user, else USER, else the uid', () => {
    expect(unixUser(testHost().host)).toBe('ihor');
    const nameless = () => {
      throw new Error('uid 1001 has no passwd entry');
    };
    expect(unixUser(testHost({ username: nameless, env: { USER: 'runner' } }).host)).toBe('runner');
    expect(unixUser(testHost({ username: nameless }).host)).toBe('uid-501');
  });

  it('finds the home folder in HOME, else asks the system', () => {
    const { host, home } = testHost({ env: { HOME: '/home/ihor' } });
    expect(homeOf(host)).toBe('/home/ihor');
    expect(homeOf({ ...host, env: {} })).toBe(home);
  });

  it("says why a command failed: stderr's last line, else why it did not run, else its code", () => {
    expect(
      failure({ code: 5, stdout: '', stderr: 'Load failed\nBootstrap failed: 5: Input/output error\n' }),
    ).toBe('Bootstrap failed: 5: Input/output error');
    expect(failure({ code: null, stdout: '', stderr: '', error: 'spawn launchctl ENOENT' })).toBe(
      'spawn launchctl ENOENT',
    );
    expect(failure({ code: 3, stdout: 'x', stderr: '  ' })).toBe('exit code 3');
  });

  it('carries an exit code with a command error, 1 by default', () => {
    expect(new CommandError('no').code).toBe(1);
    expect(new CommandError('usage', 64)).toMatchObject({ name: 'CommandError', code: 64, message: 'usage' });
  });
});
