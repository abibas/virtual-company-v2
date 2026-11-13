import { AtlassianError, type AtlassianProduct, type AtlassianSignIn } from '@mwc/tools-core';

/**
 * One call to Jira or Confluence (S7.1c): `https://<site><path>` with basic auth (the account's email and API token),
 * JSON in and out, through the injected `fetch` (the server's provider client, so no test reaches Atlassian), with
 * redirects refused, a deadline per attempt and up to two retries of a 429 after its `Retry-After` (at most 10 s each).
 * A refusal is an `AtlassianError` in words, with Atlassian's own messages when it gave some (a JQL's mistake); the token
 * never appears in one. Only a site on `atlassian.net` is ever called.
 */

export type AtlassianFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface HttpOptions {
  readonly fetch: AtlassianFetch;
  /** Per attempt; 20 s. */
  readonly timeoutMs?: number;
  /** Retries of a 429; 2. */
  readonly retries?: number;
  /** The longest wait before a retry; 10 s. */
  readonly maxWaitMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** For a `Retry-After` given as a date. */
  readonly now?: () => number;
}

export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_RETRIES = 2;
export const DEFAULT_MAX_WAIT_MS = 10_000;
/** The wait before a retry when a 429 says nothing of when. */
export const DEFAULT_WAIT_MS = 1_000;

/** A site the connector calls: `<name>.atlassian.net`, as the sign-in stored it. */
export const SITE_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}\.atlassian\.net$/;

/** The longest detail of Atlassian's own an error carries. */
const DETAIL_MAX = 500;

export type Query = Readonly<Record<string, string | number | undefined>>;

export interface Call {
  readonly product: AtlassianProduct;
  readonly method: 'GET' | 'POST' | 'PUT';
  readonly path: string;
  readonly query?: Query;
  readonly body?: unknown;
}

/** Sends one call and gives its JSON (undefined for no content). */
export type Request = (signIn: AtlassianSignIn, call: Call) => Promise<unknown>;

const sleeping = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The address of a call. */
export function urlOf(site: string, path: string, query: Query = {}): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) if (value !== undefined) params.set(name, String(value));
  const search = params.toString();
  return `https://${site}${path}${search === '' ? '' : `?${search}`}`;
}

/** How long a 429 asks to wait: its `Retry-After` in seconds or as a date, within 0 and `max`. */
export function retryWait(header: string | null, now: number, max: number): number {
  if (header === null || header.trim() === '') return Math.min(DEFAULT_WAIT_MS, max);
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
  return Number.isFinite(ms) ? Math.min(Math.max(ms, 0), max) : Math.min(DEFAULT_WAIT_MS, max);
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** Atlassian's own words in an error body: Jira's `errorMessages` and `errors`, Confluence's `errors` or `message`. */
export function detailOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const record = body as Record<string, unknown>;
  const words = [...strings(record.errorMessages)];
  const errors = record.errors;
  if (Array.isArray(errors)) {
    for (const error of errors) {
      const item = error as Record<string, unknown> | null;
      const said = item?.detail ?? item?.title ?? item?.message;
      if (typeof said === 'string') words.push(said);
    }
  } else if (typeof errors === 'object' && errors !== null) {
    for (const [field, said] of Object.entries(errors))
      if (typeof said === 'string') words.push(`${field}: ${said}`);
  }
  if (typeof record.message === 'string') words.push(record.message);
  const text = words.join('; ').replace(/\s+/g, ' ').trim();
  if (text === '') return undefined;
  return text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX - 1)}…` : text;
}

const CODE_OF: Readonly<Record<number, AtlassianError['code']>> = {
  400: 'bad_request',
  401: 'needs_sign_in',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'bad_request',
  429: 'rate_limited',
};

/** A refused answer as its error, with Atlassian's words for the ones an agent can act on. */
async function refusal(response: Response, product: AtlassianProduct): Promise<AtlassianError> {
  const { status } = response;
  const code = CODE_OF[status] ?? (status >= 500 ? 'unavailable' : 'invalid_response');
  const body = await response.json().catch(() => undefined);
  const detail = ['bad_request', 'forbidden', 'not_found', 'conflict'].includes(code)
    ? detailOf(body)
    : undefined;
  return new AtlassianError(code, product, { status, detail });
}

/** The body of a 2xx answer: its JSON, or undefined for none. */
async function bodyOf(response: Response, product: AtlassianProduct): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new AtlassianError('unavailable', product, { status: response.status });
  }
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AtlassianError('invalid_response', product, { status: response.status });
  }
}

/** The request function on these options (see above). */
export function atlassianHttp(options: HttpOptions): Request {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const maxWait = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const sleep = options.sleep ?? sleeping;
  const now = options.now ?? Date.now;

  async function attempt(signIn: AtlassianSignIn, call: Call): Promise<Response> {
    const auth = Buffer.from(`${signIn.email}:${signIn.token}`).toString('base64');
    try {
      return await options.fetch(urlOf(signIn.site, call.path, call.query), {
        method: call.method,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          accept: 'application/json',
          authorization: `Basic ${auth}`,
          'user-agent': 'mwc',
          ...(call.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
      });
    } catch (error) {
      const timedOut = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
      const detail = timedOut ? `No answer in ${Math.round(timeoutMs / 1000)} s.` : undefined;
      throw new AtlassianError('unavailable', call.product, { detail });
    }
  }

  return async (signIn, call) => {
    if (!SITE_PATTERN.test(signIn.site))
      throw new AtlassianError('bad_request', call.product, {
        detail: `${signIn.site} is no Atlassian site.`,
      });
    for (let tries = 0; ; tries++) {
      const response = await attempt(signIn, call);
      if (response.status === 429 && tries < retries) {
        await response.body?.cancel().catch(() => undefined);
        await sleep(retryWait(response.headers.get('retry-after'), now(), maxWait));
        continue;
      }
      if (response.status >= 200 && response.status < 300) return bodyOf(response, call.product);
      throw await refusal(response, call.product);
    }
  };
}
