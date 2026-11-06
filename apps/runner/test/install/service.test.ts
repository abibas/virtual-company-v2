import { describe, expect, it } from 'vitest';
import { serviceManager } from '../../src/install/service.ts';
import { testHost } from '../fixtures/host.ts';

describe("the machine's service manager", () => {
  it('is launchd on macOS and systemd on Linux, and none elsewhere', () => {
    expect(serviceManager(testHost({ platform: 'darwin' }).host).name).toBe('launchd agent');
    expect(serviceManager(testHost({ platform: 'linux' }).host).name).toBe('systemd user unit');
    expect(() => serviceManager(testHost({ platform: 'win32' }).host)).toThrow(
      'the runner installs as a service on macOS and Linux, not on win32',
    );
  });
});
