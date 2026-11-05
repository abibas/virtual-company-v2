import type { LoginHelperMode } from '@mwc/shared/config';
import { captureLogger } from '@mwc/testkit';
import { describe, expect, it } from 'vitest';
import { loginHelperFromConfig, loginInstance } from '../../../src/platform/login-helper/select.ts';

const { logger } = captureLogger();
const config = (mode: LoginHelperMode) => ({ MWC_LOGIN_HELPER: mode, MWC_PORT: 9950 });

describe('loginHelperFromConfig', () => {
  it('gives the helper MWC_LOGIN_HELPER names, starting nothing, and none for none', () => {
    expect(loginHelperFromConfig(config('docker'), logger)?.mode).toBe('docker');
    expect(loginHelperFromConfig(config('local'), logger, { PATH: '/usr/bin' })?.mode).toBe('local');
    expect(loginHelperFromConfig(config('local'), logger, {})?.mode).toBe('local');
    expect(loginHelperFromConfig(config('local'), logger)?.mode).toBe('local');
    expect(loginHelperFromConfig(config('none'), logger)).toBeUndefined();
  });

  it("labels the Docker sandboxes with the server's port, the same across its restarts", () => {
    expect(loginInstance({ MWC_PORT: 9950 })).toBe('api-9950');
    expect(loginInstance({ MWC_PORT: 9963 })).toBe('api-9963');
  });
});
