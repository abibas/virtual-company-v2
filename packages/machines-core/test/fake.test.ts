import { describe, expect, it } from 'vitest';
import { FakePowerDriver } from '../src/fake.ts';
import { DEFAULT_BOX_RULES } from '../src/rules.ts';

const REF = { instance: 'dev-ihor', zone: 'us-central1-a' } as const;

async function code(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return (error as { code: string }).code;
  }
  return 'resolved';
}

describe('FakePowerDriver', () => {
  it('is an airia_devbox driver with no boxes by default, and reads an unknown box as missing', async () => {
    const driver = new FakePowerDriver();
    expect(driver.provider).toBe('airia_devbox');
    expect(await driver.discover()).toEqual([]);
    expect(await driver.status(REF)).toEqual({ status: 'missing', rules: null });
    expect(driver.box('dev-ihor')).toBeUndefined();
  });

  it('discovers its boxes with their size, cost and rules', async () => {
    const driver = new FakePowerDriver({
      boxes: [{ ref: { ...REF, size: 'm' }, hourlyCost: 0.268, rules: { timezone: 'Europe/Kyiv' } }],
    });
    expect(await driver.discover()).toEqual([
      {
        ref: { ...REF, size: 'm' },
        status: 'stopped',
        size: 'm',
        hourlyCost: 0.268,
        rules: { ...DEFAULT_BOX_RULES, timezone: 'Europe/Kyiv' },
      },
    ]);
  });

  it('starts and stops through starting and stopping, settling at the next status read', async () => {
    const driver = new FakePowerDriver({ boxes: [{ ref: REF }] });
    expect((await driver.start(REF)).status).toBe('starting');
    expect((await driver.start(REF)).status).toBe('starting');
    expect((await driver.status(REF)).status).toBe('running');
    expect((await driver.start(REF)).status).toBe('running');
    expect((await driver.stop(REF)).status).toBe('stopping');
    expect((await driver.stop(REF)).status).toBe('stopping');
    expect((await driver.status(REF)).status).toBe('stopped');
    expect((await driver.stop(REF)).status).toBe('stopped');
    expect(driver.calls.map((call) => call.call)).toEqual([
      'start',
      'start',
      'status',
      'start',
      'stop',
      'stop',
      'status',
      'stop',
    ]);
    expect(driver.calls[0]).toEqual({ call: 'start', instance: 'dev-ihor' });
  });

  it('says when a start or a stop found the box already there and did nothing', async () => {
    const driver = new FakePowerDriver({ boxes: [{ ref: REF }] });
    expect(await driver.start(REF)).not.toHaveProperty('already');
    expect(await driver.start(REF)).toMatchObject({ status: 'starting', already: true });
    expect(await driver.stop(REF)).not.toHaveProperty('already');
    expect(await driver.stop(REF)).toMatchObject({ status: 'stopping', already: true });
  });

  it('settles at once, or only when told', async () => {
    const quick = new FakePowerDriver({ settle: 'immediately', boxes: [{ ref: REF }] });
    expect((await quick.start(REF)).status).toBe('running');
    expect((await quick.stop(REF)).status).toBe('stopped');

    const manual = new FakePowerDriver({
      settle: 'manual',
      boxes: [{ ref: REF }, { ref: { ...REF, instance: 'b' } }],
    });
    await manual.start(REF);
    await manual.start({ ...REF, instance: 'b' });
    expect((await manual.status(REF)).status).toBe('starting');
    manual.settle('dev-ihor');
    expect(manual.box('dev-ihor')?.status).toBe('running');
    expect(manual.box('b')?.status).toBe('starting');
    manual.settle();
    expect(manual.box('b')?.status).toBe('running');
  });

  it('plays scripted statuses before settling, and takes status changes from outside', async () => {
    const driver = new FakePowerDriver({ boxes: [{ ref: REF, status: 'running' }] });
    driver.script('dev-ihor', 'stopping', 'stopped');
    expect((await driver.status(REF)).status).toBe('stopping');
    expect((await driver.status(REF)).status).toBe('stopped');
    expect((await driver.status(REF)).status).toBe('stopped');
    driver.setStatus('dev-ihor', 'unknown');
    expect(driver.box('dev-ihor')?.status).toBe('unknown');
    driver.setStatus('dev-ihor', 'missing');
    expect(driver.box('dev-ihor')?.rules).toBeNull();
    driver.removeBox('dev-ihor');
    expect((await driver.status(REF)).status).toBe('missing');
    expect(() => driver.script('dev-ihor', 'running')).toThrow(/no box named dev-ihor/);
  });

  it('never creates a box: start, stop and setTimezone of a missing one reject with not_found', async () => {
    const driver = new FakePowerDriver();
    expect(await code(driver.start(REF))).toBe('not_found');
    expect(await code(driver.stop(REF))).toBe('not_found');
    expect(await code(driver.setTimezone(REF, 'UTC'))).toBe('not_found');
    expect(await driver.discover()).toEqual([]);
  });

  it('sets the time zone of a box, refusing a name that is not one', async () => {
    const driver = new FakePowerDriver({ boxes: [{ ref: REF }] });
    expect((await driver.setTimezone(REF, 'Europe/Kyiv')).rules?.timezone).toBe('Europe/Kyiv');
    expect(await code(driver.setTimezone(REF, '+02:00'))).toBe('failed');
    expect(driver.box('dev-ihor')?.rules?.timezone).toBe('Europe/Kyiv');
    expect(driver.calls.at(-1)).toEqual({ call: 'setTimezone', instance: 'dev-ihor', timezone: '+02:00' });
  });

  it('fails the next call of a kind, in the order the failures were queued', async () => {
    const driver = new FakePowerDriver({ boxes: [{ ref: REF }] });
    driver.failNext('start', 'stockout_or_quota');
    driver.failNext('start', 'needs_gcloud_login', 'Sign in again.');
    driver.failNext('discover', 'cli_missing');
    expect(await code(driver.status(REF))).toBe('resolved');
    const first = await driver.start(REF).catch((error: unknown) => error);
    expect(first).toMatchObject({ code: 'stockout_or_quota', retryable: true });
    await expect(driver.start(REF)).rejects.toMatchObject({
      code: 'needs_gcloud_login',
      message: 'Sign in again.',
    });
    expect((await driver.start(REF)).status).toBe('starting');
    expect(await code(driver.discover())).toBe('cli_missing');
    expect(driver.calls).toHaveLength(5);
  });
});
