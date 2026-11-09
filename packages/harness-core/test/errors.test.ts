import { describe, expect, it } from 'vitest';
import { HARNESS_ERROR_CODES, HARNESS_ERROR_MESSAGES, HarnessError, isHarnessError } from '../src/errors.ts';

describe('HarnessError', () => {
  it('carries its code and a plain message for each code', () => {
    for (const code of HARNESS_ERROR_CODES) {
      const error = new HarnessError(code);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('HarnessError');
      expect(error.code).toBe(code);
      expect(error.message).toBe(HARNESS_ERROR_MESSAGES[code]);
    }
    expect(new HarnessError('invalid_spec', 'The message is empty.').message).toBe('The message is empty.');
  });

  it('is told apart by isHarnessError, optionally by code', () => {
    const error = new HarnessError('credential_mismatch');
    expect(isHarnessError(error)).toBe(true);
    expect(isHarnessError(error, 'credential_mismatch')).toBe(true);
    expect(isHarnessError(error, 'invalid_spec')).toBe(false);
    expect(isHarnessError(new Error('x'))).toBe(false);
    expect(isHarnessError('credential_mismatch')).toBe(false);
  });
});
