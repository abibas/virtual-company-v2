import { isSlackError, type SlackError } from '@mwc/tools-core';
import { describe, expect, it } from 'vitest';
import { formOf, limitWait, refusalOf, slackHttp, UNSAID_WAIT_MS, waitWords } from '../src/http.ts';
import { fakeFetch, ok, refused, SIGN_IN } from './fixtures/fetch.ts';

/** The error a call rejects with. */
async function failure(promise: Promise<unknown>): Promise<SlackError> {
  try {
    await promise;
  } catch (error) {
    if (isSlackError(error)) return error;
    throw error;
  }
  throw new Error('the call did not fail');
}

const noSleep = { sleep: async () => undefined };

describe('a call to Slack', () => {
  it('posts the form-encoded arguments to slack.com/api with the token as a bearer, redirects refused', async () => {
    const { fetch, calls } = fakeFetch({ 'auth.test': ok({ team: 'Airia' }) });
    const call = slackHttp({ fetch });
    expect(await call(SIGN_IN, 'auth.test', { a: 1, b: undefined, blocks: [{ type: 'divider' }] })).toEqual({
      ok: true,
      team: 'Airia',
    });
    expect(calls[0]).toMatchObject({
      url: 'https://slack.com/api/auth.test',
      form: { a: '1', blocks: '[{"type":"divider"}]' },
      redirect: 'manual',
      headers: {
        authorization: 'Bearer xoxb-FAKE-token-123',
        'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
      },
    });
    expect(await call(SIGN_IN, 'auth.test')).toMatchObject({ ok: true });
    expect(formOf({ x: true, y: 'a b' })).toBe('x=true&y=a+b');
  });

  it.each([
    ['invalid_auth', 'needs_sign_in'],
    ['token_revoked', 'needs_sign_in'],
    ['account_inactive', 'needs_sign_in'],
    ['channel_not_found', 'not_found'],
    ['not_in_channel', 'not_in_channel'],
    ['no_permission', 'forbidden'],
    ['msg_too_long', 'bad_request'],
    ['internal_error', 'unavailable'],
  ] as const)('reads Slack’s %s as %s, keeping Slack’s own error', async (slackError, code) => {
    const { fetch } = fakeFetch({ 'chat.postMessage': refused(slackError) });
    const error = await failure(slackHttp({ fetch })(SIGN_IN, 'chat.postMessage'));
    expect(error).toMatchObject({ code, slackError, status: 200 });
    expect(error.message).toContain(`Slack said: ${slackError}.`);
    expect(error.message).not.toContain(SIGN_IN.token);
  });

  it('names the scope a missing_scope needs and says to reinstall the app', () => {
    const error = refusalOf({ ok: false, error: 'missing_scope', needed: 'chat:write' }, 200);
    expect(error).toMatchObject({ code: 'forbidden', slackError: 'missing_scope' });
    expect(error.message).toContain('lacks the scope chat:write');
    expect(error.message).toContain('reinstall the app');
    expect(refusalOf({ ok: false }, 200)).toMatchObject({ code: 'bad_request', slackError: 'unknown_error' });
  });

  it('retries a rate limit after its Retry-After, at most twice, then says when to try again', async () => {
    const limited = { status: 429, headers: { 'retry-after': '2' } };
    const waits: number[] = [];
    const sleep = async (ms: number) => {
      waits.push(ms);
    };
    const { fetch, calls } = fakeFetch({ 'conversations.history': [limited, limited, ok({ messages: [] })] });
    expect(await slackHttp({ fetch, sleep })(SIGN_IN, 'conversations.history')).toMatchObject({ ok: true });
    expect(waits).toEqual([2000, 2000]);
    expect(calls).toHaveLength(3);

    const always = fakeFetch({ 'conversations.history': limited });
    const error = await failure(
      slackHttp({ fetch: always.fetch, ...noSleep })(SIGN_IN, 'conversations.history'),
    );
    expect(error).toMatchObject({ code: 'rate_limited', status: 429, slackError: 'ratelimited' });
    expect(error.message).toContain('Try again in 2 s.');
    expect(always.calls).toHaveLength(3);
  });

  it('refuses at once a rate limit whose wait is too long, and reads `error: ratelimited` as one', async () => {
    const long = fakeFetch({ 'search.messages': { status: 429, headers: { 'retry-after': '60' } } });
    const error = await failure(slackHttp({ fetch: long.fetch, ...noSleep })(SIGN_IN, 'search.messages'));
    expect(error.message).toContain('Try again in 60 s.');
    expect(error.retryAfterMs).toBe(60_000);
    expect(long.calls).toHaveLength(1);
    const inBody = fakeFetch({ 'search.messages': [refused('ratelimited'), ok()] });
    const call = slackHttp({ fetch: inBody.fetch, maxWaitMs: UNSAID_WAIT_MS, ...noSleep });
    expect(await call(SIGN_IN, 'search.messages')).toMatchObject({ ok: true });
    expect(limitWait(new Response(null, { status: 429 }))).toBe(UNSAID_WAIT_MS);
    expect(waitWords(180_000)).toBe('Try again in 3 minutes.');
  });

  it('says an outage, a timeout, a redirect, a 401 and an unreadable answer in words', async () => {
    const cases: [Parameters<typeof fakeFetch>[0][string], string][] = [
      [{ status: 503 }, 'unavailable'],
      [{ status: 302 }, 'invalid_response'],
      [{ status: 401 }, 'needs_sign_in'],
      [{ status: 404 }, 'invalid_response'],
      [{ text: 'not json' }, 'invalid_response'],
      [{ text: '[1]' }, 'invalid_response'],
      [new TypeError('fetch failed'), 'unavailable'],
    ];
    for (const [answer, code] of cases) {
      const { fetch } = fakeFetch({ 'users.list': answer });
      expect(await failure(slackHttp({ fetch })(SIGN_IN, 'users.list'))).toMatchObject({ code });
    }
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const slow = fakeFetch({ 'users.list': timeout });
    const error = await failure(slackHttp({ fetch: slow.fetch, timeoutMs: 15_000 })(SIGN_IN, 'users.list'));
    expect(error.message).toContain('No answer in 15 s.');
  });

  it('says a body that cannot be read is an outage', async () => {
    const broken = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error('reset'));
        },
      }),
    );
    const call = slackHttp({ fetch: async () => broken });
    expect(await failure(call(SIGN_IN, 'users.list'))).toMatchObject({ code: 'unavailable' });
  });
});
