import { FakePowerDriver } from '@mwc/machines-core/fake';
import { newId } from '@mwc/shared/ids';
import type { PowerAction } from '@mwc/shared/machines';
import type { PowerCommand } from '@mwc/shared/runner-protocol';
import { describe, expect, it } from 'vitest';
import { driverExecutor, outcomeOf } from '../../src/power/airia-devbox.ts';
import { runPowerCommand } from '../../src/power.ts';

const REF = { instance: 'dev-ihor', zone: 'europe-west1-b', size: 'm' as const };
const RULES = {
  timezone: 'America/Chicago',
  idleShutdownMin: 45,
  idleOffhoursMin: 20,
  idleLoadThreshold: 0.5,
  workStartHour: 8,
  workEndHour: 19,
  nightlyStopHour: 20,
};

const command = (action: PowerAction, args?: PowerCommand['args']): PowerCommand => ({
  type: 'power.command',
  cmdId: newId(),
  target: { provider: 'airia_devbox', ref: REF },
  action,
  ...(args ? { args } : {}),
});

const driver = () => new FakePowerDriver({ boxes: [{ ref: REF, status: 'stopped', hourlyCost: 0.268 }] });

describe('the power executor of a driver', () => {
  it("announces the driver's provider and maps each action to the driver, answering its reading", async () => {
    const fake = driver();
    const executor = driverExecutor(fake);
    expect(executor.providers).toEqual(['airia_devbox']);
    expect(await executor.execute(command('start'))).toEqual({
      ok: true,
      status: 'starting',
      metadata: { size: 'm', hourlyCost: 0.268, rules: RULES },
    });
    expect((await executor.execute(command('status'))).status).toBe('running');
    expect((await executor.execute(command('stop'))).status).toBe('stopping');
    const zoned = await executor.execute(command('set_timezone', { timezone: 'Europe/Kyiv' }));
    expect(zoned.metadata).toMatchObject({ rules: { ...RULES, timezone: 'Europe/Kyiv' } });
    expect(fake.calls.map((entry) => entry.call)).toEqual(['start', 'status', 'stop', 'setTimezone']);
  });

  it('answers a missing box with its status and no facts', async () => {
    const executor = driverExecutor(new FakePowerDriver());
    expect(await executor.execute(command('status'))).toEqual({
      ok: true,
      status: 'missing',
      metadata: { size: null, hourlyCost: null, rules: null },
    });
    expect(outcomeOf({ status: 'running', rules: null })).toEqual({
      ok: true,
      status: 'running',
      metadata: { size: null, hourlyCost: null, rules: null },
    });
  });

  it("answers the driver's error as its code and message, which the server reads back", async () => {
    const fake = driver();
    fake.failNext('start', 'needs_gcloud_login');
    const executor = driverExecutor(fake);
    expect(await executor.execute(command('start'))).toEqual({
      ok: false,
      error:
        'needs_gcloud_login: The Google Cloud sign-in on the controlling machine is missing or has expired. Run `gcloud auth login` there.',
    });
    fake.failNext('stop', 'failed', 'x'.repeat(3000));
    expect((await executor.execute(command('stop'))).error).toHaveLength(2000);
  });

  it('refuses another provider, and leaves any other throw to the power hook', async () => {
    const executor = driverExecutor(driver());
    const other = { ...command('status'), target: { provider: 'gce', ref: REF } } as unknown as PowerCommand;
    expect(await executor.execute(other)).toEqual({
      ok: false,
      error: 'failed: this runner powers airia_devbox machines only',
    });
    const broken = new FakePowerDriver({ boxes: [{ ref: REF }] });
    broken.status = async () => {
      throw new Error('the driver broke');
    };
    const cmd = command('status');
    expect(await runPowerCommand(driverExecutor(broken), cmd)).toEqual({
      type: 'power.result',
      cmdId: cmd.cmdId,
      ok: false,
      error: 'the driver broke',
    });
  });
});
