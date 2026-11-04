import { describe, expect, it } from 'vitest';
import { permutations, seededRandom, shuffled } from '../../src/scenario/random.ts';

describe('seeded shuffles and permutations', () => {
  it('gives the same numbers in [0, 1) for the same seed, and others for another', () => {
    const take = (seed: number) => Array.from({ length: 5 }, seededRandom(seed));
    expect(take(42)).toEqual(take(42));
    expect(take(42)).not.toEqual(take(43));
    expect(take(42).every((n) => n >= 0 && n < 1)).toBe(true);
  });

  it('shuffles a copy, keeping every item', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const once = shuffled(items, seededRandom(1));
    expect(once).not.toBe(items);
    expect([...once].sort()).toEqual(items);
    expect(shuffled(items, seededRandom(1))).toEqual(once);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('lists every ordering once', () => {
    const all = [...permutations(['a', 'b', 'c'])].map((p) => p.join(''));
    expect(all).toEqual(['abc', 'acb', 'bac', 'bca', 'cab', 'cba']);
    expect([...permutations([])]).toEqual([[]]);
  });
});
