/**
 * The mwc API as the CLI and `@mwc/mcp` call it: a GET (or a POST without a body) with a personal API key as the
 * bearer, through an injected fetch, answering the body (when the caller's guard accepts it) or the server's refusal,
 * `{ error: { code, message } }`. Exported as `@mwc/cli/api/client`.
 */

/** `fetch` as the commands use it; tests pass a fake, or one that calls a test app in-process. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** How long a call may take. */
export const API_TIMEOUT_MS = 15_000;

/** A call that did not give the body: the server's refusal, or why there was no answer like this API's. */
export interface ApiFailure {
  readonly ok: false;
  /** The HTTP status, or 0 when the server could not be reached or did not answer like this API. */
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

export type ApiResult<T> = { readonly ok: true; readonly body: T } | ApiFailure;

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** The error body's code and message (`{ error: { code, message } }`), or ones made from the status. */
async function failure(res: Response): Promise<ApiFailure> {
  const body: unknown = await res.json().catch(() => undefined);
  const error = isObject(body) && isObject(body.error) ? body.error : {};
  return {
    ok: false,
    status: res.status,
    code: typeof error.code === 'string' ? error.code : `http_${res.status}`,
    message: typeof error.message === 'string' ? error.message : `the server answered ${res.status}`,
  };
}

/** A call's method and the status its body comes with. */
export interface CallOptions {
  readonly method?: 'GET' | 'POST';
  /** 200 for a GET, 201 for a POST that makes something. */
  readonly status?: number;
}

/**
 * `<method> <server><path>` (no body) with the key as the bearer; the body when it comes with `options.status` (200 by
 * default) and `accept` takes it.
 */
export async function apiCall<T>(
  fetch: Fetch,
  server: string,
  key: string,
  path: string,
  accept: (body: unknown) => body is T,
  options: CallOptions = {},
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${server}${path}`, {
      method: options.method ?? 'GET',
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch (error) {
    // Node's fetch says only "fetch failed"; the reason (ECONNREFUSED, ENOTFOUND, ...) is its cause.
    const cause = (error as { cause?: { code?: unknown } }).cause?.code;
    const why = typeof cause === 'string' ? ` (${cause})` : '';
    const message = `cannot reach ${server}: ${(error as Error).message}${why}`;
    return { ok: false, status: 0, code: 'unreachable', message };
  }
  if (res.status !== (options.status ?? 200)) return failure(res);
  const body: unknown = await res.json().catch(() => undefined);
  if (!accept(body)) {
    return {
      ok: false,
      status: 0,
      code: 'bad_response',
      message: `${server} does not answer like the mwc API`,
    };
  }
  return { ok: true, body };
}

/** `GET <server><path>` with the key as the bearer; the body when it is a 200 that `accept` takes. */
export function apiGet<T>(
  fetch: Fetch,
  server: string,
  key: string,
  path: string,
  accept: (body: unknown) => body is T,
): Promise<ApiResult<T>> {
  return apiCall(fetch, server, key, path, accept);
}
