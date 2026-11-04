import { describe, expect, it } from 'vitest';
import {
  IDENTITY_PROVIDER_ERROR_CODES,
  IdentityProviderError,
  type IdentityProviderErrorCode,
  isIdentityProviderError,
} from './errors.ts';

describe('IdentityProviderError', () => {
  it('lists the codes callers branch on', () => {
    expect(IDENTITY_PROVIDER_ERROR_CODES).toEqual([
      'not_found',
      'conflict',
      'rate_limited',
      'unauthorized',
      'invalid',
      'unavailable',
    ]);
  });

  it('carries its code, the wait the provider asked for and the cause', () => {
    const cause = new Error('429 from the provider');
    const error = new IdentityProviderError('rate_limited', 'too many invitations', {
      retryAfterMs: 3600_000,
      cause,
    });
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: 'IdentityProviderError',
      code: 'rate_limited',
      message: 'too many invitations',
      retryAfterMs: 3600_000,
      cause,
    });
    const plain = new IdentityProviderError('not_found', 'no such organization');
    expect(plain.retryAfterMs).toBeUndefined();
    expect('cause' in plain).toBe(false);
  });

  it.each<[IdentityProviderErrorCode, boolean]>([
    ['not_found', false],
    ['conflict', false],
    ['rate_limited', true],
    ['unauthorized', false],
    ['invalid', false],
    ['unavailable', true],
  ])('%s is retryable: %s', (code, retryable) => {
    expect(new IdentityProviderError(code, code).retryable).toBe(retryable);
  });

  it('is recognized, optionally by code, and nothing else is', () => {
    const error = new IdentityProviderError('conflict', 'taken');
    expect(isIdentityProviderError(error)).toBe(true);
    expect(isIdentityProviderError(error, 'conflict')).toBe(true);
    expect(isIdentityProviderError(error, 'not_found')).toBe(false);
    for (const other of [new Error('conflict'), { code: 'conflict' }, 'conflict', null, undefined]) {
      expect(isIdentityProviderError(other)).toBe(false);
    }
  });
});
