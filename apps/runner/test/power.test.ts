import { newId } from '@mwc/shared/ids';
import type { PowerCommand } from '@mwc/shared/runner-protocol';
import { describe, expect, it } from 'vitest';
import { NO_POWER, NO_POWER_DRIVER, type PowerExecutor, runPowerCommand } from '../src/power.ts';

const command = (): PowerCommand => ({
  type: 'power.command',
  cmdId: newId(),
  target: { provider: 'airia_devbox', ref: { instance: 'dev-ihor', zone: 'europe-west1-b' } },
  action: 'status',
});

describe('the power hook', () => {
  it('drives nothing by default: every command fails with no_power_driver', async () => {
    const cmd = command();
    expect(NO_POWER.providers).toEqual([]);
    expect(await runPowerCommand(NO_POWER, cmd)).toEqual({
      type: 'power.result',
      cmdId: cmd.cmdId,
      ok: false,
      error: NO_POWER_DRIVER,
    });
  });

  it("answers with an executor's outcome", async () => {
    const executor: PowerExecutor = {
      providers: ['airia_devbox'],
      execute: async () => ({ ok: true, status: 'running', metadata: { zone: 'europe-west1-b' } }),
    };
    const cmd = command();
    expect(await runPowerCommand(executor, cmd)).toEqual({
      type: 'power.result',
      cmdId: cmd.cmdId,
      ok: true,
      status: 'running',
      metadata: { zone: 'europe-west1-b' },
    });
  });

  it('turns a throw into ok: false with its message, or a plain one', async () => {
    const throwing = (error: unknown): PowerExecutor => ({
      providers: [],
      execute: async () => {
        throw error;
      },
    });
    const cmd = command();
    expect(await runPowerCommand(throwing(new Error('gcloud is not signed in')), cmd)).toMatchObject({
      ok: false,
      error: 'gcloud is not signed in',
    });
    expect(await runPowerCommand(throwing('weird'), cmd)).toMatchObject({
      ok: false,
      error: 'the power command failed',
    });
    expect((await runPowerCommand(throwing(new Error('x'.repeat(3000))), cmd)).error).toHaveLength(2000);
  });
});
