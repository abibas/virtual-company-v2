import { AtlassianError } from '@mwc/tools-core';
import { describe, expect, it } from 'vitest';
import { atlassianHttp, DEFAULT_WAIT_MS, detailOf, retryWait, urlOf } from '../src/http.ts';
import { type Answer, fakeFetch, SIGN_IN } from './fixtures/fetch.ts';

const GET = { product: 'Jira', method: 'GET', path: '/rest/api/3/myself' } as const;

function http(answers: Answer | readonly Answer[], options: { sleep?: (ms: number) => Promise<void> } = {}) {
  const fake = fakeFetch({ 'GET /rest/api/3/myself': answers });
  const waits: number[] = [];
  const request = atlassianHttp({
    fetch: fake.fetch,
    sleep:
      options.sleep ??
      ((ms) => {
        waits.push(ms);
        return Promise.resolve();
      }),
    now: () => Date.parse('2026-11-13T10:00:00Z'),
  });
  return { request, calls: fake.calls, waits };
}

const refusedWith = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as AtlassianError;
  }
  throw new Error('it did not refuse');
};

describe('one call to Atlassian', () => {
  it('goes to the site with basic auth, JSON and redirects refused, and gives the answer’s JSON', async () => {
    const { request, calls } = http({ body: { accountId: 'a-1' } });
    expect(await request(SIGN_IN, { ...GET, query: { expand: 'groups', skip: undefined } })).toEqual({
      accountId: 'a-1',
    });
    const [call] = calls;
    expect(call?.url.toString()).toBe('https://acme.atlassian.net/rest/api/3/myself?expand=groups');
    expect(call?.headers).toEqual({
      accept: 'application/json',
      authorization: `Basic ${Buffer.from('ihor@example.com:tok-123').toString('base64')}`,
      'user-agent': 'mwc',
    });
    expect(call?.redirect).toBe('manual');
  });

  it('sends a body as JSON, and reads no content as nothing', async () => {
    const fake = fakeFetch({ 'POST /rest/api/3/issue/AP-1/transitions': { status: 204 } });
    const request = atlassianHttp({ fetch: fake.fetch });
    const call = { product: 'Jira', method: 'POST', path: '/rest/api/3/issue/AP-1/transitions' } as const;
    expect(await request(SIGN_IN, { ...call, body: { transition: { id: '31' } } })).toBeUndefined();
    expect(fake.calls[0]?.headers['content-type']).toBe('application/json');
    expect(fake.calls[0]?.body).toEqual({ transition: { id: '31' } });
  });

  it('never calls a site that is not on atlassian.net', async () => {
    const { request, calls } = http({ body: {} });
    const error = await refusedWith(request({ ...SIGN_IN, site: 'evil.example.com' }, GET));
    expect(error.code).toBe('bad_request');
    expect(calls).toEqual([]);
  });

  it('retries a 429 after its Retry-After, at most twice, then says it is rate limited', async () => {
    const limited = { status: 429, headers: { 'retry-after': '3' } };
    const later = http([limited, { status: 429 }, { body: { ok: 1 } }]);
    expect(await later.request(SIGN_IN, GET)).toEqual({ ok: 1 });
    expect(later.waits).toEqual([3000, DEFAULT_WAIT_MS]);
    const never = http([limited]);
    const error = await refusedWith(never.request(SIGN_IN, GET));
    expect(error).toMatchObject({ code: 'rate_limited', status: 429 });
    expect(never.calls).toHaveLength(3);
  });

  it('waits as Retry-After says, a date too, within 0 and the most', () => {
    const now = Date.parse('2026-11-13T10:00:00Z');
    expect(retryWait('2', now, 10_000)).toBe(2000);
    expect(retryWait('120', now, 10_000)).toBe(10_000);
    expect(retryWait('Fri, 13 Nov 2026 10:00:05 GMT', now, 10_000)).toBe(5000);
    expect(retryWait('Fri, 13 Nov 2026 09:00:00 GMT', now, 10_000)).toBe(0);
    expect(retryWait(null, now, 10_000)).toBe(DEFAULT_WAIT_MS);
    expect(retryWait('soon', now, 10_000)).toBe(DEFAULT_WAIT_MS);
    expect(retryWait('', now, 500)).toBe(500);
  });

  it('says each refusal in words: 401 sign in again, 403, 404, 400 with Atlassian’s words, 409, 5xx', async () => {
    const cases: [Answer, string, string | RegExp][] = [
      [{ status: 401, body: { message: 'secret detail' } }, 'needs_sign_in', /sign in again/],
      [
        { status: 403, body: { errorMessages: ['No browse permission.'] } },
        'forbidden',
        /No browse permission\./,
      ],
      [
        { status: 404, body: { errorMessages: ['Issue does not exist'] } },
        'not_found',
        /Issue does not exist/,
      ],
      [{ status: 400, body: { errorMessages: ["Field 'x' does not exist."] } }, 'bad_request', /Field 'x'/],
      [{ status: 409, body: { errors: [{ title: 'Version conflict' }] } }, 'conflict', /Version conflict/],
      [{ status: 503, text: 'down' }, 'unavailable', /did not answer/],
      [
        { status: 302, headers: { location: 'https://elsewhere.example' } },
        'invalid_response',
        /could not be read/,
      ],
    ];
    for (const [answer, code, words] of cases) {
      const error = await refusedWith(http(answer).request(SIGN_IN, GET));
      expect(error).toBeInstanceOf(AtlassianError);
      expect(error.code).toBe(code);
      expect(error.message).toMatch(words);
      expect(error.message).not.toContain('tok-123');
    }
    const unauthorized = await refusedWith(
      http({ status: 401, body: { message: 'secret detail' } }).request(SIGN_IN, GET),
    );
    expect(unauthorized.message).not.toContain('secret detail');
  });

  it('says a network failure, a deadline and an answer that is no JSON', async () => {
    const network = await refusedWith(http(new TypeError('fetch failed')).request(SIGN_IN, GET));
    expect(network).toMatchObject({ code: 'unavailable' });
    const deadline = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const late = await refusedWith(http(deadline).request(SIGN_IN, GET));
    expect(late.message).toContain('No answer in 20 s.');
    const garbled = await refusedWith(http({ text: '<html>' }).request(SIGN_IN, GET));
    expect(garbled).toMatchObject({ code: 'invalid_response', status: 200 });
  });
});

describe('the parts', () => {
  it('builds an address with its query, leaving out what is undefined', () => {
    expect(
      urlOf('acme.atlassian.net', '/wiki/api/v2/spaces', { keys: 'ENG,OPS', cursor: undefined, limit: 25 }),
    ).toBe('https://acme.atlassian.net/wiki/api/v2/spaces?keys=ENG%2COPS&limit=25');
  });

  it('reads Atlassian’s own words from Jira’s and Confluence’s error shapes, cut to 500', () => {
    expect(detailOf({ errorMessages: ['A.'], errors: { summary: 'is required' } })).toBe(
      'A.; summary: is required',
    );
    expect(detailOf({ errors: [{ detail: 'Bad space.' }, { code: 'X' }] })).toBe('Bad space.');
    expect(detailOf({ message: 'CQL invalid' })).toBe('CQL invalid');
    expect(detailOf({ errorMessages: [] })).toBeUndefined();
    expect(detailOf('nope')).toBeUndefined();
    expect(detailOf({ message: 'x'.repeat(600) })?.length).toBe(500);
  });
});
