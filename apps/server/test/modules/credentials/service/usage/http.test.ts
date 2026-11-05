import { describe, expect, it } from 'vitest';
import {
  expiresSoon,
  MAX_ANSWER_LENGTH,
  outcomeOf,
  providerCall,
  providerFetchFor,
  readObject,
  refreshFailure,
  UsageFailure,
} from '../../../../../src/modules/credentials/service/usage/http.ts';

/** What a failing step threw, as its code. */
const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'resolved',
    (error: unknown) => (error instanceof UsageFailure ? error.code : String(error)),
  );

describe('providerCall', () => {
  it('refuses redirects, sets a deadline, and turns a network failure into provider_unavailable', async () => {
    let seen: RequestInit | undefined;
    const ok = await providerCall(
      async (_url, init) => {
        seen = init;
        return new Response('{}');
      },
      'https://example.test/usage',
      { method: 'GET' },
    );
    expect(ok.status).toBe(200);
    expect(seen?.redirect).toBe('error');
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
    const down = () => Promise.reject(new TypeError('connect ECONNREFUSED'));
    expect(await codeOf(providerCall(down, 'https://example.test', {}))).toBe('provider_unavailable');
  });
});

describe('readObject', () => {
  it('reads one JSON object', async () => {
    expect(await readObject(new Response('{"a":1}'))).toEqual({ a: 1 });
  });

  it('refuses an answer too long, not JSON, or not an object, and a body that breaks off', async () => {
    expect(await codeOf(readObject(new Response(`"${'x'.repeat(MAX_ANSWER_LENGTH)}"`)))).toBe(
      'invalid_response',
    );
    expect(await codeOf(readObject(new Response('nope')))).toBe('invalid_response');
    expect(await codeOf(readObject(new Response('[1]')))).toBe('invalid_response');
    expect(await codeOf(readObject(new Response('null')))).toBe('invalid_response');
    const broken = new Response(
      new ReadableStream({
        start: (controller) => controller.error(new Error('socket hang up')),
      }),
    );
    expect(await codeOf(readObject(broken))).toBe('provider_unavailable');
  });
});

describe('outcomeOf', () => {
  it('turns a UsageFailure into its outcome and throws anything else', async () => {
    expect(await outcomeOf(async () => [])).toEqual({ ok: true, windows: [] });
    expect(
      await outcomeOf(async () => {
        throw new UsageFailure('rate_limited');
      }),
    ).toEqual({ ok: false, code: 'rate_limited' });
    await expect(
      outcomeOf(async () => {
        throw new RangeError('a bug');
      }),
    ).rejects.toThrow(RangeError);
  });
});

describe('the token rules', () => {
  it('refreshes a token within 5 minutes of its expiry, never one with no expiry', () => {
    const now = new Date('2026-11-03T12:00:00Z');
    expect(expiresSoon(now.getTime() + 5 * 60_000, now)).toBe(true);
    expect(expiresSoon(now.getTime() + 5 * 60_000 + 1, now)).toBe(false);
    expect(expiresSoon(now.getTime() - 1, now)).toBe(true);
    expect(expiresSoon(undefined, now)).toBe(false);
  });

  it('asks to sign in again only when the provider refuses a refresh', () => {
    expect([400, 401, 403, 429, 500, 503].map((status) => refreshFailure(status).code)).toEqual([
      'needs_sign_in',
      'needs_sign_in',
      'needs_sign_in',
      'rate_limited',
      'provider_unavailable',
      'provider_unavailable',
    ]);
  });
});

describe('providerFetchFor', () => {
  it('refuses every call under NODE_ENV=test', async () => {
    await expect(providerFetchFor({ NODE_ENV: 'test' })('https://api.anthropic.com')).rejects.toThrow(
      /No network in tests/,
    );
  });

  it('calls the platform fetch otherwise', async () => {
    const calls: string[] = [];
    const fake: typeof fetch = async (input) => {
      calls.push(String(input));
      return new Response('{}');
    };
    const client = providerFetchFor({ NODE_ENV: 'development' }, fake);
    expect((await client('https://example.test/usage')).status).toBe(200);
    expect(calls).toEqual(['https://example.test/usage']);
  });
});
