import type { GitHubSignIn } from '@mwc/tools-core';
import type { GitHubFetch } from '../../src/http.ts';

/** The sign-in the tests use: a made-up token. */
export const SIGN_IN: GitHubSignIn = { token: 'ghp_FAKEtoken123' };

/** A repository the tests read. */
export const REPO = { owner: 'acme', repo: 'web' } as const;

/** An answer of the fake: a status (200), a JSON body or a text, headers; or an error the fetch throws. */
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
  const fetch: GitHubFetch = async (input, init) => {
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

/** A pull request as GitHub's REST API gives it (the fields the connector reads). */
export const rawPull = (number: number, extra: Record<string, unknown> = {}) => ({
  number,
  node_id: `PR_node${number}`,
  title: `Pull ${number}`,
  state: 'open',
  draft: false,
  merged: false,
  html_url: `https://github.com/acme/web/pull/${number}`,
  user: { login: 'ihor' },
  head: { ref: `feature-${number}`, sha: `sha${number}`, repo: { full_name: 'acme/web' } },
  base: { ref: 'main', repo: { full_name: 'acme/web' } },
  labels: [{ name: 'bug' }],
  body: 'Fixes the login.',
  created_at: '2026-11-10T10:00:00Z',
  updated_at: '2026-11-12T10:00:00Z',
  ...extra,
});
