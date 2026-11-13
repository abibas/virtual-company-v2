import type { AtlassianSignIn } from '@mwc/tools-core';
import type { AtlassianFetch } from '../../src/http.ts';

/** The sign-in the tests use: a made-up token on a made-up site. */
export const SIGN_IN: AtlassianSignIn = {
  site: 'acme.atlassian.net',
  email: 'ihor@example.com',
  token: 'tok-123',
};

/** An answer of the fake: a status (200), a JSON body, headers; or an error the fetch throws. */
export type Answer =
  | {
      readonly status?: number;
      readonly body?: unknown;
      readonly text?: string;
      readonly headers?: Record<string, string>;
    }
  | Error;

/** A call the fake received. */
export interface Recorded {
  readonly method: string;
  readonly url: URL;
  readonly headers: Record<string, string>;
  readonly body: unknown;
  readonly redirect: RequestInit['redirect'];
}

/**
 * A fetch that answers by `METHOD /path` from `routes` (a list is answered in turn, its last answer kept), records each
 * call, and answers 599 to anything else so a missing route shows.
 */
export function fakeFetch(routes: Record<string, Answer | readonly Answer[]>) {
  const calls: Recorded[] = [];
  const turns = new Map<string, number>();
  const fetch: AtlassianFetch = async (input, init) => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    const key = `${method} ${url.pathname}`;
    calls.push({
      method,
      url,
      headers: { ...(init.headers as Record<string, string>) },
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      redirect: init.redirect,
    });
    const route = routes[key];
    const list = route === undefined ? [{ status: 599 }] : Array.isArray(route) ? route : [route];
    const turn = turns.get(key) ?? 0;
    turns.set(key, turn + 1);
    const answer = list[Math.min(turn, list.length - 1)] as Answer;
    if (answer instanceof Error) throw answer;
    const text = answer.text ?? (answer.body === undefined ? '' : JSON.stringify(answer.body));
    const status = answer.status ?? 200;
    return new Response(status === 204 ? null : text, { status, headers: answer.headers ?? {} });
  };
  return { fetch, calls };
}

/** ADF of one paragraph of text. */
export const adf = (text: string) => ({
  type: 'doc',
  version: 1,
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
