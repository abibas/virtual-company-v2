import { describe, expect, it } from 'vitest';
import { ATLASSIAN_ERROR_CODES, AtlassianError, isAtlassianError } from '../src/errors.ts';

describe('AtlassianError', () => {
  it('says each code in words, naming the product, with Atlassian’s own detail after', () => {
    for (const code of ATLASSIAN_ERROR_CODES) {
      const error = new AtlassianError(code, 'Jira');
      expect(error.message).toMatch(/^Jira /);
      expect(error).toMatchObject({ code, product: 'Jira', status: null, name: 'AtlassianError' });
    }
    const refused = new AtlassianError('bad_request', 'Confluence', { status: 400, detail: 'CQL is wrong.' });
    expect(refused.message).toBe('Confluence refused the request as written. CQL is wrong.');
    expect(refused.status).toBe(400);
    expect(new AtlassianError('needs_sign_in', 'Jira').message).toContain('sign in again');
  });

  it('is told apart from other errors', () => {
    expect(isAtlassianError(new AtlassianError('not_found', 'Jira'))).toBe(true);
    expect(isAtlassianError(new Error('x'))).toBe(false);
  });
});
