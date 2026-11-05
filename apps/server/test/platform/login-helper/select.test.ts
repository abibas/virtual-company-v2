import { captureLogger } from '@mwc/testkit';
import { describe, expect, it } from 'vitest';
import { loginHelperFromConfig } from '../../../src/platform/login-helper/select.ts';

const { logger } = captureLogger();

describe('loginHelperFromConfig', () => {
  it('gives the helper MWC_LOGIN_HELPER names, starting nothing, and none for none', () => {
    expect(loginHelperFromConfig({ MWC_LOGIN_HELPER: 'docker' }, logger)?.mode).toBe('docker');
    expect(loginHelperFromConfig({ MWC_LOGIN_HELPER: 'local' }, logger, { PATH: '/usr/bin' })?.mode).toBe(
      'local',
    );
    expect(loginHelperFromConfig({ MWC_LOGIN_HELPER: 'local' }, logger, {})?.mode).toBe('local');
    expect(loginHelperFromConfig({ MWC_LOGIN_HELPER: 'local' }, logger)?.mode).toBe('local');
    expect(loginHelperFromConfig({ MWC_LOGIN_HELPER: 'none' }, logger)).toBeUndefined();
  });
});
