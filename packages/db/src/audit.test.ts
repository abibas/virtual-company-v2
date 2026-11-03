import { describe, expect, it } from 'vitest';
import { diffFields, sameValue } from './audit.ts';

describe('diffFields', () => {
  it('reports changed, added and removed fields, sorted, and skips unchanged ones', () => {
    const before = { name: 'Acme', slug: 'acme', status: 'active', legacy: 1 };
    const after = { name: 'Acme Corp', slug: 'acme', status: 'active', imageUrl: 'https://x/y.png' };
    expect(diffFields(before, after)).toEqual([
      { field: 'imageUrl', old: null, new: 'https://x/y.png' },
      { field: 'legacy', old: 1, new: null },
      { field: 'name', old: 'Acme', new: 'Acme Corp' },
    ]);
  });

  it('returns nothing for equal rows', () => {
    expect(diffFields({ a: 1, b: null }, { a: 1, b: null })).toEqual([]);
  });

  it('treats a created or deleted row as all fields added or removed', () => {
    expect(diffFields(null, { b: 2, a: 1 })).toEqual([
      { field: 'a', old: null, new: 1 },
      { field: 'b', old: null, new: 2 },
    ]);
    expect(diffFields({ a: 1 }, undefined)).toEqual([{ field: 'a', old: 1, new: null }]);
  });

  it('treats undefined, absent and null alike', () => {
    expect(diffFields({ a: undefined, b: null }, { c: undefined })).toEqual([]);
  });

  it('compares nested jsonb by value, regardless of key order', () => {
    const before = { settings: { theme: { dark: true, accent: 'red' }, seats: [1, 2] } };
    expect(diffFields(before, { settings: { seats: [1, 2], theme: { accent: 'red', dark: true } } })).toEqual(
      [],
    );
    expect(diffFields(before, { settings: { seats: [2, 1], theme: { accent: 'red', dark: true } } })).toEqual(
      [
        {
          field: 'settings',
          old: before.settings,
          new: { seats: [2, 1], theme: { accent: 'red', dark: true } },
        },
      ],
    );
  });

  it('compares dates by time and honours ignore', () => {
    const at = new Date('2026-11-03T10:00:00Z');
    expect(diffFields({ deletedAt: at }, { deletedAt: new Date(at.getTime()) })).toEqual([]);
    expect(
      diffFields(
        { name: 'a', updatedAt: at },
        { name: 'b', updatedAt: new Date() },
        { ignore: ['updatedAt'] },
      ),
    ).toEqual([{ field: 'name', old: 'a', new: 'b' }]);
  });
});

describe('sameValue', () => {
  it('follows jsonb equality', () => {
    expect(sameValue({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(sameValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameValue({ a: 1, b: undefined }, { a: 1, c: 2 })).toBe(false);
    expect(sameValue([1, [2, { x: 3 }]], [1, [2, { x: 3 }]])).toBe(true);
    expect(sameValue([1, 2], [1, 2, 3])).toBe(false);
    expect(sameValue([1], { 0: 1 })).toBe(false);
    expect(sameValue(1, '1')).toBe(false);
    expect(sameValue(Number.NaN, Number.NaN)).toBe(true);
    expect(sameValue(new Date(0), 0)).toBe(false);
    expect(sameValue(Object.create(null), {})).toBe(true);
    expect(sameValue(new Map(), new Map([[1, 2]]))).toBe(false);
  });
});
