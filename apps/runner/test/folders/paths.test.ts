import { describe, expect, it } from 'vitest';
import { childOf, isWithin, parentOf, resolveFolder } from '../../src/folders/paths.ts';

const MAC = { home: '/Users/ihor', root: null };
const BOX = { home: '/home/runner', root: '/work' };

describe('resolving a folder path', () => {
  it('takes an absolute path and normalizes dots, repeated and trailing slashes', () => {
    expect(resolveFolder('/Users/ihor/agents/', MAC)).toEqual({ ok: true, path: '/Users/ihor/agents' });
    expect(resolveFolder('//a/./b//c/../d', MAC)).toEqual({ ok: true, path: '/a/b/d' });
    expect(resolveFolder('/', MAC)).toEqual({ ok: true, path: '/' });
    expect(resolveFolder('/a/..', MAC)).toEqual({ ok: true, path: '/' });
  });

  it('resolves ~ and ~/ with the home, but not ~someone', () => {
    expect(resolveFolder('~', MAC)).toEqual({ ok: true, path: '/Users/ihor' });
    expect(resolveFolder('~/agents/scout', MAC)).toEqual({ ok: true, path: '/Users/ihor/agents/scout' });
    expect(resolveFolder('~root/x', MAC)).toMatchObject({ ok: false, code: 'invalid_path' });
  });

  it('refuses a relative path, a NUL and a .. that climbs above /', () => {
    expect(resolveFolder('agents', MAC)).toEqual({
      ok: false,
      code: 'invalid_path',
      words: 'agents is not an absolute path',
    });
    expect(resolveFolder('', MAC)).toMatchObject({ code: 'invalid_path' });
    expect(resolveFolder('/a\0b', MAC)).toMatchObject({ code: 'invalid_path' });
    expect(resolveFolder('/a/../../etc', MAC)).toEqual({
      ok: false,
      code: 'invalid_path',
      words: '/a/../../etc climbs above /',
    });
  });

  it('keeps every path of a container under its root', () => {
    expect(resolveFolder('/work', BOX)).toEqual({ ok: true, path: '/work' });
    expect(resolveFolder('/work/scout/', BOX)).toEqual({ ok: true, path: '/work/scout' });
    expect(resolveFolder('/work/../etc', BOX)).toEqual({
      ok: false,
      code: 'outside_volume',
      words: '/etc is outside /work',
    });
    expect(resolveFolder('/workshop', BOX)).toMatchObject({ code: 'outside_volume' });
    expect(resolveFolder('~', BOX)).toMatchObject({ code: 'outside_volume' });
  });
});

describe('a folder’s parent and child', () => {
  it('has no parent at / or at the root', () => {
    expect(parentOf('/', null)).toBeNull();
    expect(parentOf('/work', '/work')).toBeNull();
    expect(parentOf('/work/a', '/work')).toBe('/work');
    expect(parentOf('/Users', null)).toBe('/');
    expect(parentOf('/Users/ihor', null)).toBe('/Users');
  });

  it('joins a name to a folder, and tells a path inside a root', () => {
    expect(childOf('/', 'a')).toBe('/a');
    expect(childOf('/a', 'b')).toBe('/a/b');
    expect(isWithin('/anything', '/')).toBe(true);
    expect([isWithin('/work', '/work'), isWithin('/work/a', '/work'), isWithin('/workx', '/work')]).toEqual([
      true,
      true,
      false,
    ]);
  });
});
