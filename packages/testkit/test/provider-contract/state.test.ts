import { IdentityProviderError } from '@mwc/identity-core';
import { describe, expect, it } from 'vitest';
import { collect, need, providerError } from '../../src/provider-contract/state.ts';

describe('contract helpers', () => {
  it('need returns a value an earlier case left, and names what is missing otherwise', () => {
    expect(need(0, 'zero')).toBe(0);
    expect(() => need(undefined, 'owner')).toThrow('contract: no owner (an earlier case failed)');
  });

  it('providerError returns the provider error, and fails on success or on another error', async () => {
    const error = new IdentityProviderError('conflict', 'taken');
    expect(await providerError(() => Promise.reject(error))).toBe(error);
    await expect(providerError(() => Promise.resolve(1))).rejects.toThrow(
      'expected an IdentityProviderError',
    );
    await expect(providerError(() => Promise.reject(new TypeError('boom')))).rejects.toThrow(TypeError);
  });

  it('collect reads an async iterable to the end', async () => {
    async function* three() {
      yield* [1, 2, 3];
    }
    expect(await collect(three())).toEqual([1, 2, 3]);
  });
});
