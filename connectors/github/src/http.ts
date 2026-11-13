import { GitHubError, type GitHubSignIn } from '@mwc/tools-core';

/**
 * One call to GitHub (S7.1d): `https://api.github.com<path>` with the sign-in's token as a bearer, GitHub's JSON (or a
 * pull request's diff as text) and its API version, through the injected `fetch` (the server's provider client, so no
 * test reaches GitHub), with redirects refused and a deadline per attempt. A rate limit (429, or a 403 that says so with
 * `Retry-After` or no requests left until `X-RateLimit-Reset`) is retried up to twice when its wait is short (at most
 * 10 s each), else refused saying when to try again. A refusal is a `GitHubError` in words, with GitHub's own messages
 * where an agent can act on them; the token never appears in one. Only `api.github.com` is ever called.
 */

export type GitHubFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface HttpOptions {
  readonly fetch: GitHubFetch;
  /** Per attempt; 20 s. */
  readonly timeoutMs?: number;
  /** Retries of a rate limit; 2. */
  readonly retries?: number;
  /** The longest wait before a retry; 10 s. Longer waits are refused at once. */
  readonly maxWaitMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** For `Retry-After` given as a date and `X-RateLimit-Reset`. */
  readonly now?: () => number;
}

export const API = 'https://api.github.com';
export const API_VERSION = '2022-11-28';
export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_RETRIES = 2;
export const DEFAULT_MAX_WAIT_MS = 10_000;
/** GitHub's advice for a secondary rate limit that says nothing of when: wait at least a minute. */
export const SECONDARY_WAIT_MS = 60_000;

/** The longest detail of GitHub's own an error carries. */
const DETAIL_MAX = 500;

export type Query = Readonly<Record<string, string | number | boolean | undefined>>;

export interface Call {
  readonly method: 'GET' | 'POST' | 'PATCH';
  readonly path: string;
  readonly query?: Query;
  readonly body?: unknown;
  /** `diff` asks for a pull request's diff as text; JSON otherwise. */
  readonly accept?: 'json' | 'diff';
}

/** Sends one call and gives its JSON (undefined for no content), or a diff's text. */
export type Request = (signIn: GitHubSignIn, call: Call) => Promise<unknown>;

const ACCEPT = { json: 'application/vnd.github+json', diff: 'application/vnd.github.diff' } as const;

const sleeping = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The address of a call. */
export function urlOf(path: string, query: Query = {}): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) if (value !== undefined) params.set(name, String(value));
  const search = params.toString();
  return `${API}${path}${search === '' ? '' : `?${search}`}`;
}

/**
 * How long a refused answer asks to wait before trying again, in ms, or undefined when it is no rate limit: its
 * `Retry-After` (seconds or a date), else the reset of a limit with no requests left, else a minute for a 429.
 */
export function limitWait(response: Response, now: number): number | undefined {
  const { status, headers } = response;
  if (status !== 429 && status !== 403) return undefined;
  const after = headers.get('retry-after')?.trim();
  if (after) {
    const seconds = Number(after);
    const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(after) - now;
    if (Number.isFinite(ms)) return Math.max(ms, 0);
  }
  const reset = Number(headers.get('x-ratelimit-reset'));
  if (headers.get('x-ratelimit-remaining') === '0' && Number.isFinite(reset) && reset > 0)
    return Math.max(reset * 1000 - now, 0);
  return status === 429 ? SECONDARY_WAIT_MS : undefined;
}

/** When to try again, in words. */
export const waitWords = (ms: number) =>
  ms < 120_000
    ? `Try again in ${Math.ceil(ms / 1000)} s.`
    : `Try again in ${Math.ceil(ms / 60_000)} minutes.`;

const strings = (items: unknown): string[] =>
  (Array.isArray(items) ? items : []).flatMap((item) => {
    if (typeof item === 'string') return [item];
    const error = item as Record<string, unknown> | null;
    if (typeof error?.message === 'string') return [error.message];
    const said = [error?.field, error?.code].filter((part) => typeof part === 'string');
    return said.length > 0 ? [said.join(' ')] : [];
  });

/** GitHub's own words in an error body: its `message` and each of its `errors`. */
export function detailOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const record = body as Record<string, unknown>;
  const words = [typeof record.message === 'string' ? record.message : '', ...strings(record.errors)];
  const text = words
    .filter((word) => word !== '')
    .join('; ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text === '') return undefined;
  return text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX - 1)}…` : text;
}

const CODE_OF: Readonly<Record<number, GitHubError['code']>> = {
  400: 'bad_request',
  401: 'needs_sign_in',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  410: 'not_found',
  422: 'bad_request',
};

const MOVED =
  'GitHub answered with a redirect: the repository may have been renamed or moved; use its current name.';

/** A refused answer as its error, with GitHub's words where they help (not a 401's, a 404's or an outage's). */
async function refusal(response: Response): Promise<GitHubError> {
  const { status } = response;
  if (status >= 300 && status < 400) return new GitHubError('invalid_response', { status, detail: MOVED });
  const code = CODE_OF[status] ?? (status >= 500 ? 'unavailable' : 'invalid_response');
  const body = await response.json().catch(() => undefined);
  const plain = status === 404 || code === 'unavailable' || code === 'needs_sign_in';
  const detail = plain ? undefined : detailOf(body);
  if (status === 403 && /rate limit/i.test(detail ?? ''))
    return new GitHubError('rate_limited', { status, detail: waitWords(SECONDARY_WAIT_MS) });
  return new GitHubError(code, { status, detail });
}

/** The body of a 2xx answer: a diff's text, or its JSON (undefined for none). */
async function bodyOf(response: Response, accept: 'json' | 'diff'): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new GitHubError('unavailable', { status: response.status });
  }
  if (accept === 'diff') return text;
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new GitHubError('invalid_response', { status: response.status });
  }
}

/** The request function on these options (see above). */
export function githubHttp(options: HttpOptions): Request {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const maxWait = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const sleep = options.sleep ?? sleeping;
  const now = options.now ?? Date.now;

  async function attempt(signIn: GitHubSignIn, call: Call): Promise<Response> {
    try {
      return await options.fetch(urlOf(call.path, call.query), {
        method: call.method,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          accept: ACCEPT[call.accept ?? 'json'],
          authorization: `Bearer ${signIn.token}`,
          'x-github-api-version': API_VERSION,
          'user-agent': 'mwc',
          ...(call.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
      });
    } catch (error) {
      const timedOut = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
      const detail = timedOut ? `No answer in ${Math.round(timeoutMs / 1000)} s.` : undefined;
      throw new GitHubError('unavailable', { detail });
    }
  }

  return async (signIn, call) => {
    for (let tries = 0; ; tries++) {
      const response = await attempt(signIn, call);
      if (response.status >= 200 && response.status < 300) return bodyOf(response, call.accept ?? 'json');
      const wait = limitWait(response, now());
      if (wait === undefined) throw await refusal(response);
      await response.body?.cancel().catch(() => undefined);
      if (tries >= retries || wait > maxWait)
        throw new GitHubError('rate_limited', { status: response.status, detail: waitWords(wait) });
      await sleep(wait);
    }
  };
}
