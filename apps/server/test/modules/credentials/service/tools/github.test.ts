import { describe, expect, it } from 'vitest';
import {
  checkGitHub,
  GITHUB_API_VERSION,
  TOOL_USER_AGENT,
} from '../../../../../src/modules/credentials/service/tools/github.ts';
import { FakeProvider, json } from '../../../../fixtures/credentials/providers.ts';
import {
  CLASSIC_TOKEN,
  FINE_TOKEN,
  GITHUB_USER,
  githubUser,
  status,
} from '../../../../fixtures/credentials/tools.ts';

describe('checkGitHub', () => {
  it('asks GET /user with the token as the bearer, no redirects and a deadline, and keeps the account and scopes', async () => {
    const provider = new FakeProvider().always(GITHUB_USER, githubUser('repo, read:org, workflow'));
    expect(await checkGitHub(provider.fetch, CLASSIC_TOKEN, true)).toEqual({
      ok: true,
      accountEmail: null,
      accountMeta: {
        host: 'github.com',
        login: 'ihor-fake',
        name: 'Ihor Fake',
        scopes: ['repo', 'read:org', 'workflow'],
        tokenType: 'classic',
      },
    });
    expect(provider.calls).toEqual([
      {
        url: GITHUB_USER,
        method: 'GET',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${CLASSIC_TOKEN}`,
          'user-agent': TOOL_USER_AGENT,
          'x-github-api-version': GITHUB_API_VERSION,
        },
        body: undefined,
        redirect: 'error',
        hasDeadline: true,
      },
    ]);
  });

  it('keeps no scopes for a fine-grained token, and no token type for a sign-in', async () => {
    const provider = new FakeProvider().always(GITHUB_USER, githubUser(null));
    expect(await checkGitHub(provider.fetch, FINE_TOKEN, true)).toMatchObject({
      ok: true,
      accountMeta: { login: 'ihor-fake', tokenType: 'fine_grained' },
    });
    const signedIn = await checkGitHub(provider.fetch, 'gho_FAKE', false);
    expect(signedIn).toMatchObject({ ok: true });
    expect(signedIn.ok && signedIn.accountMeta).not.toHaveProperty('tokenType');
    expect(signedIn.ok && signedIn.accountMeta).not.toHaveProperty('scopes');
  });

  it.each([
    ['a 401', status(401), 'needs_sign_in'],
    ['a 403 with requests left', status(403, { 'x-ratelimit-remaining': '12' }), 'refused'],
    ['a 403 with none left', status(403, { 'x-ratelimit-remaining': '0' }), 'rate_limited'],
    ['a 429', status(429), 'rate_limited'],
    ['a 502', status(502), 'provider_unavailable'],
    ['a 404', status(404), 'invalid_response'],
    ['a body that is not JSON', () => new Response('<html>', { status: 200 }), 'invalid_response'],
    ['a user without a login', json(200, { id: 1 }), 'invalid_response'],
    [
      'a network failure',
      () => {
        throw new TypeError('fetch failed');
      },
      'provider_unavailable',
    ],
  ])('reads %s as %s', async (_, answer, code) => {
    const provider = new FakeProvider().always(GITHUB_USER, answer);
    expect(await checkGitHub(provider.fetch, CLASSIC_TOKEN, true)).toEqual({ ok: false, code });
  });
});
