import { describe, expect, it } from 'vitest';
import {
  isMachinePowerError,
  MACHINE_POWER_ERROR_CODES,
  MACHINE_POWER_ERROR_MESSAGES,
  MachinePowerError,
} from '../src/errors.ts';

describe('MachinePowerError', () => {
  it('lists the codes callers branch on, each with a plain-words message', () => {
    expect(MACHINE_POWER_ERROR_CODES).toEqual([
      'needs_gcloud_login',
      'cli_missing',
      'not_found',
      'stockout_or_quota',
      'timeout',
      'failed',
    ]);
    for (const code of MACHINE_POWER_ERROR_CODES)
      expect(MACHINE_POWER_ERROR_MESSAGES[code]).toMatch(/^[A-Z].+\.$/);
    expect(MACHINE_POWER_ERROR_MESSAGES.needs_gcloud_login).toContain('gcloud auth login');
  });

  it('takes its code’s message unless given one, and carries the detail and the cause', () => {
    const plain = new MachinePowerError('timeout');
    expect(plain).toBeInstanceOf(Error);
    expect(plain).toMatchObject({ name: 'MachinePowerError', code: 'timeout', detail: undefined });
    expect(plain.message).toBe(MACHINE_POWER_ERROR_MESSAGES.timeout);
    expect('cause' in plain).toBe(false);

    const cause = new Error('exit 1');
    const full = new MachinePowerError('failed', 'The box would not stop.', { detail: 'ERROR: x', cause });
    expect(full).toMatchObject({ message: 'The box would not stop.', detail: 'ERROR: x', cause });
  });

  it('is retryable for a stockout and a timeout only', () => {
    const retryable = MACHINE_POWER_ERROR_CODES.filter((code) => new MachinePowerError(code).retryable);
    expect(retryable).toEqual(['stockout_or_quota', 'timeout']);
  });

  it('is recognized, optionally by code', () => {
    const error = new MachinePowerError('not_found');
    expect(isMachinePowerError(error)).toBe(true);
    expect(isMachinePowerError(error, 'not_found')).toBe(true);
    expect(isMachinePowerError(error, 'failed')).toBe(false);
    expect(isMachinePowerError(new Error('not_found'))).toBe(false);
  });
});
