import { IdentityProviderError } from '@mwc/identity-core';
import { describe, expect, it, vi } from 'vitest';
import { ClerkCalls } from '../../src/backend/calls.ts';
import type { ClerkBackendApi } from '../../src/backend/client.ts';
import { DEFAULT_RETRY_AFTER_MS } from '../../src/backend/errors.ts';
import { RateGate } from '../../src/backend/rate-limit.ts';
import { apiError, page } from '../fixtures/backend.ts';

function calls(pageSize = 2) {
  let now = 0;
  const gate = new RateGate(() => now);
  return {
    calls: new ClerkCalls({} as ClerkBackendApi, gate, pageSize),
    gate,
    tick: (ms: number) => (now += ms),
  };
}

async function code(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return (error as { code: string }).code;
  }
  return 'resolved';
}

describe('ClerkCalls', () => {
  it('maps failures, and after a 429 refuses the bucket without calling Clerk until Retry-After', async () => {
    const { calls: c, tick } = calls();
    const run = vi
      .fn()
      .mockRejectedValueOnce(apiError(429, 'too_many_requests', 3))
      .mockResolvedValue('ok');
    expect(await code(c.call('getUser', run))).toBe('rate_limited');
    expect(await code(c.call('getUser', run))).toBe('rate_limited');
    expect(run).toHaveBeenCalledTimes(1);
    tick(3_000);
    expect(await c.call('getUser', run)).toBe('ok');
  });

  it('waits the default time after a rate_limited error that names no wait', async () => {
    const { calls: c, tick } = calls();
    const limited = new IdentityProviderError('rate_limited', 'no Retry-After');
    expect(await code(c.call('getUser', () => Promise.reject(limited)))).toBe('rate_limited');
    tick(DEFAULT_RETRY_AFTER_MS - 1);
    expect(await code(c.call('getUser', async () => 'x'))).toBe('rate_limited');
    tick(1);
    expect(await c.call('getUser', async () => 'x')).toBe('x');
  });

  it('closes only the invitation bucket after a 429 on an invitation', async () => {
    const { calls: c } = calls();
    await code(c.call('createInvitation', () => Promise.reject(apiError(429)), 'invitations'));
    expect(await code(c.call('createInvitation', async () => 'x', 'invitations'))).toBe('rate_limited');
    expect(await c.call('getUser', async () => 'still fine')).toBe('still fine');
  });

  it('resolves null for a 404 where asked, and rethrows anything else', async () => {
    const { calls: c } = calls();
    expect(await c.callOrNull('getUser', () => Promise.reject(apiError(404)))).toBeNull();
    expect(await c.callOrNull('getUser', async () => 1)).toBe(1);
    expect(await code(c.callOrNull('getUser', () => Promise.reject(apiError(500))))).toBe('unavailable');
  });

  it('reads every page until the total, stopping early on an empty page', async () => {
    const { calls: c } = calls(2);
    const fetchPage = vi.fn(async (_api: ClerkBackendApi, offset: number, limit: number) =>
      page(['a', 'b', 'c', 'd', 'e'].slice(offset, offset + limit), 5),
    );
    const all: string[] = [];
    for await (const item of c.pages('list', fetchPage)) all.push(item);
    expect(all).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(fetchPage.mock.calls.map((call) => [call[1], call[2]])).toEqual([
      [0, 2],
      [2, 2],
      [4, 2],
    ]);
    const lying = vi.fn(async () => page<string>([], 10));
    for await (const _ of c.pages('list', lying)) throw new Error('no items expected');
    expect(lying).toHaveBeenCalledTimes(1);
  });
});
