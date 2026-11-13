import { SlackError, type SlackErrorCode, type SlackSignIn } from '@mwc/tools-core';

/**
 * One call to Slack (S7.1e): `POST https://slack.com/api/<method>` with the token as a bearer and the arguments
 * form-encoded (what every Web API method takes; blocks as JSON), through the injected `fetch` (the server's provider
 * client, so no test reaches Slack), with redirects refused and a deadline per attempt. Slack answers a refusal with HTTP
 * 200 and `{ok: false, error}`; a rate limit with 429 and `Retry-After` (or `error: ratelimited`), retried up to twice
 * when its wait is short (at most 10 s each), else refused saying when to try again (the wait kept as `retryAfterMs`). A refusal is a `SlackError` in words
 * with Slack's own error kept; the token never appears in one. Only `slack.com` is ever called.
 */

export type SlackFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface HttpOptions {
  readonly fetch: SlackFetch;
  /** Per attempt; 20 s. */
  readonly timeoutMs?: number;
  /** Retries of a rate limit; 2. */
  readonly retries?: number;
  /** The longest wait before a retry; 10 s. Longer waits are refused at once. */
  readonly maxWaitMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export const API = 'https://slack.com/api';
export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_RETRIES = 2;
export const DEFAULT_MAX_WAIT_MS = 10_000;
/** How long a rate limit that says nothing of when asks to wait: Slack's tiers reset within a minute. */
export const UNSAID_WAIT_MS = 30_000;

/** A method's arguments: plain values, and objects or arrays (blocks) sent as JSON. */
export type Params = Readonly<Record<string, string | number | boolean | object | undefined>>;

/** Sends one method call and gives Slack's answer (`ok: true`), or rejects with a `SlackError`. */
export type Request = (
  signIn: SlackSignIn,
  method: string,
  params?: Params,
) => Promise<Record<string, unknown>>;

const sleeping = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The form body of a call's arguments. */
export function formOf(params: Params): string {
  const form = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined) continue;
    form.set(name, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  return form.toString();
}

/** Slack's errors by what they mean here; any other is `bad_request`, with Slack's own error named. */
const CODE_OF: Readonly<Record<string, SlackErrorCode>> = {
  invalid_auth: 'needs_sign_in',
  not_authed: 'needs_sign_in',
  account_inactive: 'needs_sign_in',
  token_revoked: 'needs_sign_in',
  token_expired: 'needs_sign_in',
  missing_scope: 'forbidden',
  no_permission: 'forbidden',
  restricted_action: 'forbidden',
  not_allowed_token_type: 'forbidden',
  access_denied: 'forbidden',
  ekm_access_denied: 'forbidden',
  team_access_not_granted: 'forbidden',
  channel_not_found: 'not_found',
  user_not_found: 'not_found',
  users_not_found: 'not_found',
  thread_not_found: 'not_found',
  message_not_found: 'not_found',
  not_found: 'not_found',
  not_in_channel: 'not_in_channel',
  ratelimited: 'rate_limited',
  fatal_error: 'unavailable',
  internal_error: 'unavailable',
  service_unavailable: 'unavailable',
  request_timeout: 'unavailable',
};

/** When to try again, in words. */
export const waitWords = (ms: number) =>
  ms < 120_000
    ? `Try again in ${Math.ceil(ms / 1000)} s.`
    : `Try again in ${Math.ceil(ms / 60_000)} minutes.`;

/** How long a rate limit asks to wait, in ms: its `Retry-After` in seconds, else Slack's usual half a minute. */
export function limitWait(response: Response): number {
  const seconds = Number(response.headers.get('retry-after')?.trim());
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : UNSAID_WAIT_MS;
}

const words = (value: unknown) => (typeof value === 'string' ? value.slice(0, 300) : '');

/** Slack's `{ok: false}` answer as its error: its code, and Slack's own words (`missing_scope` names what it needs). */
export function refusalOf(body: Record<string, unknown>, status: number): SlackError {
  const slackError = typeof body.error === 'string' ? body.error : 'unknown_error';
  const code = CODE_OF[slackError] ?? 'bad_request';
  const needed = words(body.needed);
  const detail =
    slackError === 'missing_scope' && needed !== ''
      ? `The token lacks the scope ${needed}: add it to the Slack app, reinstall the app, and add the new token again.`
      : `Slack said: ${slackError}.`;
  return new SlackError(code, { slackError, status, detail });
}

/** A 2xx answer's body as one object, or `invalid_response`. */
async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new SlackError('unavailable', { status: response.status });
  }
  try {
    const body = JSON.parse(text) as unknown;
    if (typeof body === 'object' && body !== null && !Array.isArray(body))
      return body as Record<string, unknown>;
  } catch {
    // Not JSON: said below.
  }
  throw new SlackError('invalid_response', { status: response.status });
}

/** A non-2xx answer that is no rate limit as its error. */
function failureOf(status: number): SlackError {
  if (status >= 300 && status < 400)
    return new SlackError('invalid_response', { status, detail: 'Slack answered with a redirect.' });
  if (status === 401) return new SlackError('needs_sign_in', { status });
  return new SlackError(status >= 500 ? 'unavailable' : 'invalid_response', { status });
}

/** The request function on these options (see above). */
export function slackHttp(options: HttpOptions): Request {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const maxWait = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const sleep = options.sleep ?? sleeping;

  async function attempt(signIn: SlackSignIn, method: string, params: Params): Promise<Response> {
    try {
      return await options.fetch(`${API}/${method}`, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          authorization: `Bearer ${signIn.token}`,
          'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
          'user-agent': 'mwc',
        },
        body: formOf(params),
      });
    } catch (error) {
      const timedOut = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
      const detail = timedOut ? `No answer in ${Math.round(timeoutMs / 1000)} s.` : undefined;
      throw new SlackError('unavailable', { detail });
    }
  }

  return async (signIn, method, params = {}) => {
    for (let tries = 0; ; tries++) {
      const response = await attempt(signIn, method, params);
      const { status } = response;
      if (status !== 429 && (status < 200 || status >= 300)) {
        await response.body?.cancel().catch(() => undefined);
        throw failureOf(status);
      }
      const body = status === 429 ? { ok: false, error: 'ratelimited' } : await bodyOf(response);
      if (body.ok === true) return body;
      if (body.error !== 'ratelimited') throw refusalOf(body, status);
      await response.body?.cancel().catch(() => undefined);
      const wait = limitWait(response);
      if (tries >= retries || wait > maxWait)
        throw new SlackError('rate_limited', {
          slackError: 'ratelimited',
          status,
          detail: waitWords(wait),
          retryAfterMs: wait,
        });
      await sleep(wait);
    }
  };
}
