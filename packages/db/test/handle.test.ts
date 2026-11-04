import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { type DbHandle, pingDb, queryRows } from '../src/handle.ts';

describe('queryRows on postgres.js', () => {
  it('returns the rows postgres.js gives as a plain array (PGlite is covered in status.test.ts)', async () => {
    // postgres.js resolves to an array with extra fields (count, command); callers get the rows only.
    const result = Object.assign([{ one: 1 }], { count: 1, command: 'SELECT' });
    const handle = { driver: 'postgres-js', db: { execute: async () => result } } as unknown as DbHandle;
    const rows = await queryRows(handle, sql`select 1 as one`);
    expect(rows).toEqual([{ one: 1 }]);
    expect(Object.keys(rows)).toEqual(['0']);
    await expect(pingDb(handle)).resolves.toBeUndefined();
  });
});
