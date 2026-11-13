import { describe, expect, it } from 'vitest';
import { done, excerpt, refused } from '../../../../src/modules/integrations/service/reply.ts';

/** A server tool's answers and the excerpts its audit rows keep (S7.1c, shared since S7.1d). */

describe('a server tool’s reply', () => {
  it('is its JSON when done, its words when refused', () => {
    expect(done({ a: 1 })).toEqual({ ok: true, text: '{\n "a": 1\n}' });
    expect(refused('No.')).toEqual({ ok: false, text: 'No.' });
  });

  it('keeps a text whole in an audit row up to 500 characters, else its start and an ellipsis', () => {
    expect(excerpt('short')).toBe('short');
    expect(excerpt('x'.repeat(500))).toBe('x'.repeat(500));
    expect(excerpt('y'.repeat(501))).toBe(`${'y'.repeat(499)}…`);
  });
});
