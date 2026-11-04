import { IdentityProviderError } from '@mwc/identity-core';
import { describe, expect, it } from 'vitest';
import {
  describeFailure,
  ERROR_LENGTH,
  RETRY_FIRST_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  retryDelayMs,
} from '../../../src/platform/jobs/retry.ts';

describe('the jobs retry policy', () => {
  it('doubles the delay from 30 s up to an hour, unless the provider asked for longer', () => {
    expect([1, 2, 3, 4].map((n) => retryDelayMs(n))).toEqual([30_000, 60_000, 120_000, 240_000]);
    expect(retryDelayMs(0)).toBe(RETRY_FIRST_DELAY_MS);
    expect(retryDelayMs(20)).toBe(RETRY_MAX_DELAY_MS);
    expect(retryDelayMs(1, 5_000)).toBe(30_000);
    expect(retryDelayMs(1, 7_200_000)).toBe(7_200_000);
  });

  it("says a provider error's code and message, an error's message or the value, cut short", () => {
    expect(describeFailure(new IdentityProviderError('conflict', 'slug taken'))).toBe('conflict: slug taken');
    expect(describeFailure(new Error('plain'))).toBe('plain');
    expect(describeFailure('a string')).toBe('a string');
    expect(describeFailure(new Error('x'.repeat(900)))).toHaveLength(ERROR_LENGTH);
  });
});
