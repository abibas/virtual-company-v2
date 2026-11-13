import { GitHubError } from '@mwc/tools-core';
import { describe, expect, it } from 'vitest';
import { detailOf, githubHttp, limitWait, SECONDARY_WAIT_MS, urlOf, waitWords } from '../src/http.ts';
import { type Answer, fakeFetch, SIGN_IN } from './fixtures/fetch.ts';

const GET = { method: 'GET', path: '/user' } as const;
const NOW = Date.parse('2026-11-13T10:00:00Z');

function http(answers: Answer | readonly Answer[]) {
  const fake = fakeFetch({ 'GET /user': answers });
  const waits: number[] = [];
  const request = githubHttp({
    fetch: fake.fetch,
    sleep: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
    now: () => NOW,
  });
  return { request, calls: fake.calls, waits };
}

const refusedWith = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as GitHubError;
  }
  throw new Error('it did not refuse');
};

describe('one call to GitHub', () => {
  it('goes to api.github.com with the bearer, its API version, JSON and redirects refused', async () => {
    const { request, calls } = http({ body: { login: 'ihor' } });
    expect(await request(SIGN_IN, { ...GET, query: { page: 2, skip: undefined } })).toEqual({
      login: 'ihor',
    });
    const [call] = calls;
    expect(call?.url.toString()).toBe('https://api.github.com/user?page=2');
    expect(call?.headers).toEqual({
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ghp_FAKEtoken123',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'mwc',
    });
    expect(call?.redirect).toBe('manual');
  });

  it('sends a body as JSON, reads no content as nothing, and a diff as its text', async () => {
    const fake = fakeFetch({
      'POST /graphql': { status: 204 },
      'GET /repos/a/b/pulls/1': { text: 'diff --git a/x b/x\n' },
    });
    const request = githubHttp({ fetch: fake.fetch });
    expect(
      await request(SIGN_IN, { method: 'POST', path: '/graphql', body: { query: 'q' } }),
    ).toBeUndefined();
    expect(fake.calls[0]?.headers['content-type']).toBe('application/json');
    expect(fake.calls[0]?.body).toEqual({ query: 'q' });
    const diff = await request(SIGN_IN, { method: 'GET', path: '/repos/a/b/pulls/1', accept: 'diff' });
    expect(diff).toBe('diff --git a/x b/x\n');
    expect(fake.calls[1]?.headers.accept).toBe('application/vnd.github.diff');
  });

  it('says each refusal in words: 401 signs in again, 403 and 422 with GitHub’s words, 404 plainly', async () => {
    const cases: [number, unknown, string, string | undefined][] = [
      [401, { message: 'Bad credentials' }, 'needs_sign_in', undefined],
      [403, { message: 'Resource not accessible by integration' }, 'forbidden', 'not accessible'],
      [404, { message: 'Not Found' }, 'not_found', undefined],
      [410, { message: 'Issues are disabled for this repo' }, 'not_found', 'Issues are disabled'],
      [
        422,
        { message: 'Validation Failed', errors: [{ message: 'A pull request already exists for acme:x.' }] },
        'bad_request',
        'already exists',
      ],
      [409, { message: 'Head branch was modified' }, 'conflict', 'Head branch'],
      [502, { message: 'Bad gateway' }, 'unavailable', undefined],
      [418, {}, 'invalid_response', undefined],
    ];
    for (const [status, body, code, words] of cases) {
      const error = await refusedWith(http({ status, body }).request(SIGN_IN, GET));
      expect(error).toBeInstanceOf(GitHubError);
      expect(error.code).toBe(code);
      expect(error.status).toBe(status);
      if (words) expect(error.message).toContain(words);
      else expect(error.message).not.toContain(String((body as { message?: string }).message ?? 'x'));
      expect(error.message).not.toContain('FAKEtoken');
    }
  });

  it('refuses a redirect, saying the repository may have moved', async () => {
    const error = await refusedWith(
      http({ status: 301, headers: { location: 'https://x' } }).request(SIGN_IN, GET),
    );
    expect(error.code).toBe('invalid_response');
    expect(error.message).toContain('renamed or moved');
  });

  it('retries a rate limit after its Retry-After, twice, then says when to try again', async () => {
    const limited = { status: 429, headers: { 'retry-after': '2' } };
    const twice = http([limited, limited, { body: { ok: 1 } }]);
    expect(await twice.request(SIGN_IN, GET)).toEqual({ ok: 1 });
    expect(twice.waits).toEqual([2000, 2000]);
    const always = http(limited);
    const error = await refusedWith(always.request(SIGN_IN, GET));
    expect(error.code).toBe('rate_limited');
    expect(error.message).toBe('GitHub is limiting requests. Try again in 2 s.');
    expect(always.calls).toHaveLength(3);
  });

  it('retries a secondary limit (403 with Retry-After), and refuses at once a wait over 10 s', async () => {
    const secondary = http([{ status: 403, headers: { 'retry-after': '1' } }, { body: {} }]);
    expect(await secondary.request(SIGN_IN, GET)).toEqual({});
    expect(secondary.waits).toEqual([1000]);
    const reset = String(NOW / 1000 + 1800);
    const primary = http({
      status: 403,
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset },
    });
    const error = await refusedWith(primary.request(SIGN_IN, GET));
    expect(error.code).toBe('rate_limited');
    expect(error.message).toContain('Try again in 30 minutes.');
    expect(primary.calls).toHaveLength(1);
    const said = http({ status: 403, body: { message: 'You have exceeded a secondary rate limit.' } });
    expect((await refusedWith(said.request(SIGN_IN, GET))).code).toBe('rate_limited');
  });

  it('says no answer in time, a network failure, a body that breaks or is no JSON', async () => {
    const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' });
    expect((await refusedWith(http(timeout).request(SIGN_IN, GET))).message).toContain('No answer in 20 s.');
    expect((await refusedWith(http(new Error('reset')).request(SIGN_IN, GET))).code).toBe('unavailable');
    expect((await refusedWith(http({ text: '<html>' }).request(SIGN_IN, GET))).code).toBe('invalid_response');
    const broken = githubHttp({
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error('cut'));
            },
          }),
        ),
    });
    expect((await refusedWith(broken(SIGN_IN, GET))).code).toBe('unavailable');
  });
});

describe('the helpers', () => {
  it('build addresses, read waits and GitHub’s words', () => {
    expect(urlOf('/search/issues', { q: 'is:pr repo:a/b', page: 1 })).toBe(
      'https://api.github.com/search/issues?q=is%3Apr+repo%3Aa%2Fb&page=1',
    );
    const at = (status: number, headers: Record<string, string>) => new Response(null, { status, headers });
    expect(limitWait(at(429, { 'retry-after': 'Fri, 13 Nov 2026 10:00:05 GMT' }), NOW)).toBe(5000);
    expect(limitWait(at(429, {}), NOW)).toBe(SECONDARY_WAIT_MS);
    expect(limitWait(at(403, {}), NOW)).toBeUndefined();
    expect(limitWait(at(500, { 'retry-after': '1' }), NOW)).toBeUndefined();
    expect(limitWait(at(429, { 'retry-after': 'soon' }), NOW)).toBe(SECONDARY_WAIT_MS);
    expect(waitWords(1500)).toBe('Try again in 2 s.');
    expect(
      detailOf({ message: 'Validation Failed', errors: [{ field: 'head', code: 'invalid' }, 'x'] }),
    ).toBe('Validation Failed; head invalid; x');
    expect(detailOf({ errors: [{}] })).toBeUndefined();
    expect(detailOf('text')).toBeUndefined();
    expect(detailOf({ message: 'y'.repeat(600) })?.length).toBe(500);
  });
});
