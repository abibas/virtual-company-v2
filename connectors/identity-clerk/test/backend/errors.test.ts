import { TokenVerificationError } from '@clerk/backend/errors';
import { IdentityProviderError } from '@mwc/identity-core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RETRY_AFTER_MS, toIdentityError } from '../../src/backend/errors.ts';
import { apiError } from '../fixtures/backend.ts';

describe('toIdentityError: Backend API errors', () => {
  it.each([
    [404, 'resource_not_found', 'not_found'],
    [401, 'authentication_invalid', 'unauthorized'],
    [403, 'authorization_invalid', 'unauthorized'],
    [409, 'conflict', 'conflict'],
    [422, 'form_identifier_exists', 'conflict'],
    [400, 'duplicate_record', 'conflict'],
    [400, 'already_a_member_in_organization', 'conflict'],
    [400, 'organization_invitation_not_pending', 'conflict'],
    [422, 'form_param_format_invalid', 'invalid'],
    [400, '', 'invalid'],
    [500, 'internal_clerk_error', 'unavailable'],
    [503, '', 'unavailable'],
    [undefined, 'unexpected_error', 'unavailable'],
  ] as const)('HTTP %s %s → %s', (status, code, expected) => {
    const mapped = toIdentityError(apiError(status, code), 'getUser');
    expect(mapped).toBeInstanceOf(IdentityProviderError);
    expect(mapped.code).toBe(expected);
    expect(mapped.cause).toBeInstanceOf(Error);
  });

  it('says what failed, with the status, the Clerk code and its long message', () => {
    expect(toIdentityError(apiError(404, 'resource_not_found'), 'getUser').message).toBe(
      'clerk: getUser failed (404 resource_not_found): resource_not_found long message',
    );
    expect(toIdentityError(apiError(undefined), 'listInvitations').message).toBe(
      'clerk: listInvitations failed (no response): no details',
    );
  });

  it('turns a 429 into rate_limited with Retry-After in milliseconds, or the default without one', () => {
    const limited = toIdentityError(apiError(429, 'too_many_requests', 7), 'createInvitation');
    expect([limited.code, limited.retryAfterMs, limited.retryable]).toEqual(['rate_limited', 7000, true]);
    expect(toIdentityError(apiError(429), 'x').retryAfterMs).toBe(DEFAULT_RETRY_AFTER_MS);
    expect(toIdentityError(apiError(429), 'x', 60_000).retryAfterMs).toBe(60_000);
  });
});

describe('toIdentityError: other failures', () => {
  it('keeps an identity error as it is', () => {
    const error = new IdentityProviderError('conflict', 'x');
    expect(toIdentityError(error, 'y')).toBe(error);
  });

  it('refuses a bad token as unauthorized, but an unreachable JWKS or a refused key is unavailable', () => {
    const bad = new TokenVerificationError({ reason: 'token-expired', message: 'expired' });
    expect(toIdentityError(bad, 'verifyAccessToken')).toMatchObject({
      code: 'unauthorized',
      message: 'clerk: verifyAccessToken: token-expired',
    });
    for (const reason of ['jwk-remote-failed-to-load', 'jwk-failed-to-resolve', 'secret-key-invalid']) {
      expect(toIdentityError(new TokenVerificationError({ reason, message: reason }), 'v').code).toBe(
        'unavailable',
      );
    }
    expect(
      toIdentityError(new TokenVerificationError({ reason: 'jwk-remote-missing', message: '' }), 'v').code,
    ).toBe('unauthorized');
  });

  it('reports network errors and anything unexpected as unavailable', () => {
    expect(toIdentityError(new TypeError('fetch failed'), 'getUser')).toMatchObject({
      code: 'unavailable',
      message: 'clerk: getUser failed: fetch failed',
    });
    expect(toIdentityError('weird', 'getUser').message).toBe('clerk: getUser failed: weird');
  });
});
