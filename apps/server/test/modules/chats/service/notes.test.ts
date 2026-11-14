import type { TenantDb } from '@mwc/db';
import { describe, expect, it } from 'vitest';
import { recordNote } from '../../../../src/modules/chats/service/notes.ts';

/**
 * A turn that runs no process (2026-11-14): numbered after the chat's last, it tries again when a turn took its number
 * meanwhile (a unique violation), at most three times; any other failure is thrown at once.
 */

const deps = { bus: { publish: () => undefined }, clock: () => new Date() };
const note = { kind: 'people' as const, prompt: 'Ihor added Anna', by: 'p' };

/** A tenant whose transactions all fail with this error, counting them. */
function failing(error: unknown) {
  const tries = { count: 0 };
  const t = {
    transaction: async () => {
      tries.count += 1;
      throw error;
    },
  } as unknown as TenantDb;
  return { t, tries };
}

describe('recordNote', () => {
  it('tries three times on a number taken meanwhile, then throws', async () => {
    const taken = Object.assign(new Error('duplicate key'), { code: '23505' });
    const { t, tries } = failing(taken);
    await expect(recordNote(deps, t, 'chat', note)).rejects.toBe(taken);
    expect(tries.count).toBe(3);
  });

  it('throws any other failure at once', async () => {
    const boom = new Error('boom');
    const { t, tries } = failing(boom);
    await expect(recordNote(deps, t, 'chat', note)).rejects.toBe(boom);
    expect(tries.count).toBe(1);
  });
});
