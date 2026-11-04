import { describe, expect, it } from 'vitest';
import { idTime, isId, newId } from '../src/ids.ts';

describe('newId', () => {
  it('returns lower-case UUID v7 strings', () => {
    const id = newId();
    expect(isId(id)).toBe(true);
    expect(id[14]).toBe('7');
    expect(isId('0190f5f0-0000-4000-8000-000000000000')).toBe(false);
    expect(isId(id.toUpperCase())).toBe(false);
  });

  it('never repeats and sorts in creation order, also within one millisecond', () => {
    const ids = Array.from({ length: 5000 }, () => newId());
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });

  it('encodes the creation time', () => {
    const before = Date.now();
    const at = idTime(newId()).getTime();
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });
});
