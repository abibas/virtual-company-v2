import { describe, expect, it } from 'vitest';
import { createDb } from './client.ts';

// A port nothing listens on; createDb must not connect, so no query is sent anywhere.
const url = 'postgres://mwc:mwc@127.0.0.1:9999/mwc';

describe('createDb', () => {
  it('creates a postgres.js handle without connecting, with a pool of 10 by default', async () => {
    const handle = createDb(url);
    expect(handle.driver).toBe('postgres-js');
    expect(handle.db.$client.options.max).toBe(10);
    await expect(handle.close()).resolves.toBeUndefined();
  });

  it('takes the pool size from the options', async () => {
    const handle = createDb(url, { poolSize: 3 });
    expect(handle.db.$client.options.max).toBe(3);
    await handle.close();
  });
});
