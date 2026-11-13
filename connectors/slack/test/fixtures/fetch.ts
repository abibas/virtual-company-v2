import type { SlackSignIn } from '@mwc/tools-core';
import type { SlackFetch } from '../../src/http.ts';

/** The sign-in the tests use: a made-up bot token. */
export const SIGN_IN: SlackSignIn = { token: 'xoxb-FAKE-token-123' };

/** An answer of the fake: a status (200), a JSON body or a text, headers; or an error the fetch throws. */
export type Answer =
  | {
      readonly status?: number;
      readonly body?: unknown;
      readonly text?: string;
      readonly headers?: Record<string, string>;
    }
  | Error;

/** A call the fake received: its method, its form arguments, its headers and redirect choice. */
export interface Recorded {
  readonly method: string;
  readonly url: string;
  readonly form: Record<string, string>;
  readonly headers: Record<string, string>;
  readonly redirect: RequestInit['redirect'];
}

/**
 * A fetch that answers by Slack method (`chat.postMessage`) from `routes` (a list is answered in turn, its last answer
 * kept), records each call, and answers 599 to anything else so a missing route shows.
 */
export function fakeFetch(routes: Record<string, Answer | readonly Answer[]>) {
  const calls: Recorded[] = [];
  const turns = new Map<string, number>();
  const fetch: SlackFetch = async (url, init) => {
    const method = url.replace('https://slack.com/api/', '');
    calls.push({
      method,
      url,
      form: Object.fromEntries(new URLSearchParams(String(init.body ?? ''))),
      headers: { ...(init.headers as Record<string, string>) },
      redirect: init.redirect,
    });
    const route = routes[method];
    const answers = route === undefined ? [{ status: 599 }] : Array.isArray(route) ? route : [route];
    const turn = turns.get(method) ?? 0;
    turns.set(method, turn + 1);
    const answer = answers[Math.min(turn, answers.length - 1)] as Answer;
    if (answer instanceof Error) throw answer;
    const text = answer.text ?? (answer.body === undefined ? '' : JSON.stringify(answer.body));
    return new Response(text, { status: answer.status ?? 200, headers: answer.headers ?? {} });
  };
  return { fetch, calls };
}

/** Slack's `{ok: true}` answer with these fields. */
export const ok = (fields: Record<string, unknown> = {}) => ({ body: { ok: true, ...fields } });

/** Slack's refusal: HTTP 200 and `{ok: false, error}`. */
export const refused = (error: string, fields: Record<string, unknown> = {}) => ({
  body: { ok: false, error, ...fields },
});
