import { describe, expect, it } from 'vitest';
import { CAFFEINATE_BIN, DEVBOX_KEEPALIVE_BIN, detectHoldDriver, noneDriver } from '../../src/hold/driver.ts';

const has =
  (...paths: string[]) =>
  (path: string) =>
    paths.includes(path);

describe('choosing the hold driver', () => {
  it('takes the devbox keepalive wherever it is installed', () => {
    expect(detectHoldDriver({ platform: 'linux', exists: has(DEVBOX_KEEPALIVE_BIN) })).toBe(
      'devbox_keepalive',
    );
    expect(detectHoldDriver({ platform: 'darwin', exists: has(DEVBOX_KEEPALIVE_BIN, CAFFEINATE_BIN) })).toBe(
      'devbox_keepalive',
    );
  });

  it('takes caffeinate on macOS, and nothing elsewhere (a container)', () => {
    expect(detectHoldDriver({ platform: 'darwin', exists: has(CAFFEINATE_BIN) })).toBe('caffeinate');
    expect(detectHoldDriver({ platform: 'darwin', exists: has() })).toBe('none');
    expect(detectHoldDriver({ platform: 'linux', exists: has(CAFFEINATE_BIN) })).toBe('none');
  });

  it('follows MWC_RUNNER_HOLD, and refuses a value it does not know', () => {
    const exists = has(DEVBOX_KEEPALIVE_BIN, CAFFEINATE_BIN);
    expect(detectHoldDriver({ platform: 'darwin', exists, override: 'none' })).toBe('none');
    expect(detectHoldDriver({ platform: 'darwin', exists, override: '' })).toBe('devbox_keepalive');
    expect(() => detectHoldDriver({ platform: 'darwin', exists, override: 'pmset' })).toThrow(
      'MWC_RUNNER_HOLD must be one of devbox_keepalive, caffeinate, none',
    );
  });
});

describe('the none driver', () => {
  it('reports the hold it is given and holds nothing', async () => {
    const driver = noneDriver();
    expect(driver.kind).toBe('none');
    expect(await driver.apply(1_000)).toBe(1_000);
    expect(await driver.refresh(2_000)).toBe(2_000);
    expect(await driver.apply(null)).toBeNull();
    await expect(driver.close()).resolves.toBeUndefined();
  });
});
