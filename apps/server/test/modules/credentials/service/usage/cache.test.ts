import { describe, expect, it } from 'vitest';
import {
  memoryUsageCache,
  type UsageEntry,
} from '../../../../../src/modules/credentials/service/usage/cache.ts';

describe('memoryUsageCache', () => {
  it('keeps one entry per credential, the last one set', async () => {
    const cache = memoryUsageCache();
    const at = new Date('2026-11-03T12:00:00Z');
    const good: UsageEntry = { checkedAt: at, error: null, lastGood: { windows: [], checkedAt: at } };
    const failed: UsageEntry = { ...good, error: { code: 'rate_limited', message: 'later' } };
    expect(await cache.get('a')).toBeUndefined();
    await cache.set('a', good);
    await cache.set('b', failed);
    expect(await cache.get('a')).toBe(good);
    await cache.set('a', failed);
    expect(await cache.get('a')).toBe(failed);
    expect(await memoryUsageCache().get('a')).toBeUndefined();
  });
});
