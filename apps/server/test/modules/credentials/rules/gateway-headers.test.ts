import { describe, expect, it } from 'vitest';
import {
  editHeaders,
  headerPreview,
  previewColumns,
  previewsOf,
} from '../../../../src/modules/credentials/rules/gateway-headers.ts';

describe('headerPreview', () => {
  it.each([
    ['16 characters or more: the first 8 and the last 4', 'agk-NTE5abcdefghijMHx8', 'agk-NTE5••••MHx8'],
    ['exactly 16', 'abcdefghijklmnop', 'abcdefgh••••mnop'],
    ['15: the first 2 and the last 2', 'abcdefghijklmno', 'ab••••no'],
    ['exactly 8', 'abcdefgh', 'ab••••gh'],
    ['7: the mask alone', 'abcdefg', '••••'],
    ['one character', 'x', '••••'],
    ['empty', '', '••••'],
    ['a Bearer token, its scheme kept', 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.sigabcd', 'Bearer eyJhbGci••••abcd'],
    ['a scheme in any case, a short token', 'bearer short', 'bearer ••••'],
    ['a Basic token of 8 to 15', 'Basic dXNlcjpwdw==', 'Basic dX••••=='],
    ['a scheme with nothing after it', 'Bearer ', 'Bearer ••••'],
    ['a scheme word alone', 'Bearer', '••••'],
    ['words that are not a scheme', 'my team is called x', 'my team ••••ed x'],
    ['characters beyond one code unit', '🔑🔑abcdefghijklmn🔑', '🔑🔑abcdef••••lmn🔑'],
  ])('%s', (_, value, preview) => {
    expect(headerPreview(value)).toBe(preview);
  });

  it('never holds a value of 8 characters or more whole', () => {
    for (let length = 8; length <= 64; length++) {
      const value = `${'v'.repeat(length - 1)}z`;
      expect(headerPreview(value)).not.toContain(value);
      expect(headerPreview(value)).toContain('••••');
    }
  });
});

describe('previewsOf and previewColumns', () => {
  it("lists a gateway's headers in its order, each its name and preview", () => {
    expect(previewsOf({ 'x-team': 'team-1234', Authorization: 'Bearer abc' })).toEqual([
      { name: 'x-team', preview: 'te••••34' },
      { name: 'Authorization', preview: 'Bearer ••••' },
    ]);
    expect(previewsOf({})).toEqual([]);
  });

  it("writes a gateway's previews and nothing for another kind", () => {
    expect(previewColumns({ kind: 'gateway', secret: { headers: { k: 'abc' } } })).toEqual({
      headerPreviews: [{ name: 'k', preview: '••••' }],
    });
    expect(previewColumns({ kind: 'anthropic_api_key', secret: { apiKey: 'sk-ant-api03-x' } })).toEqual({});
  });
});

describe('editHeaders', () => {
  const stored = { a: 'value-a', b: 'value-b', c: 'value-c', d: 'value-d' };

  it('keeps, renames, gives a new value, adds and removes, recording names only', () => {
    const edited = editHeaders(stored, [
      { name: 'a' },
      { name: 'b2', from: 'b' },
      { name: 'c', value: 'new-c' },
      { name: 'e', value: 'value-e' },
    ]);
    expect(edited).toEqual({
      ok: true,
      headers: { a: 'value-a', b2: 'value-b', c: 'new-c', e: 'value-e' },
      changes: [
        { field: 'header', old: 'b', new: 'b2' },
        { field: 'header_value', old: 'c', new: 'c' },
        { field: 'header', old: null, new: 'e' },
        { field: 'header', old: 'd', new: null },
      ],
    });
    expect(JSON.stringify(edited.ok && edited.changes)).not.toMatch(/value-|new-c/);
  });

  it('renames with a new value, and swaps two names', () => {
    expect(editHeaders({ a: 'value-a' }, [{ name: 'z', from: 'a', value: 'value-z' }])).toEqual({
      ok: true,
      headers: { z: 'value-z' },
      changes: [
        { field: 'header', old: 'a', new: 'z' },
        { field: 'header_value', old: 'a', new: 'z' },
      ],
    });
    const swapped = editHeaders({ a: '1', b: '2' }, [
      { name: 'a', from: 'b' },
      { name: 'b', from: 'a' },
    ]);
    expect(swapped).toMatchObject({ ok: true, headers: { a: '2', b: '1' } });
  });

  it('changes nothing for the same headers, the same value typed again, or another order', () => {
    for (const edits of [
      [{ name: 'a' }, { name: 'b' }],
      [{ name: 'a', value: 'value-a' }, { name: 'b' }],
      [{ name: 'b' }, { name: 'a' }],
    ]) {
      expect(editHeaders({ a: 'value-a', b: 'value-b' }, edits)).toEqual({
        ok: true,
        headers: { a: 'value-a', b: 'value-b' },
        changes: [],
      });
    }
  });

  it('removes every header for an empty list', () => {
    expect(editHeaders({ a: 'value-a' }, [])).toEqual({
      ok: true,
      headers: {},
      changes: [{ field: 'header', old: 'a', new: null }],
    });
  });

  it('refuses a `from` the gateway has not, and a new header without a value', () => {
    expect(editHeaders(stored, [{ name: 'x', from: 'nope', value: 'v' }])).toMatchObject({
      ok: false,
      status: 422,
      code: 'header_not_found',
      message: 'This gateway has no header nope',
    });
    expect(editHeaders(stored, [{ name: 'x' }])).toMatchObject({
      ok: false,
      status: 422,
      code: 'header_value_required',
      message: 'x is a new header: give it a value',
    });
  });
});
