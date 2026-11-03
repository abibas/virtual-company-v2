/** Anything with Hono's `app.request(path, init)`: the app, a router, a test app's `app`. */
export interface Requestable {
  request(input: string, init?: RequestInit): Response | Promise<Response>;
}

export interface JsonResponse<T = unknown> {
  readonly status: number;
  /** The parsed body when the response is JSON, the text otherwise, null when there is none. */
  readonly body: T;
  readonly headers: Headers;
}

export interface JsonRequest {
  /** Sent as JSON with `content-type: application/json`. */
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>> | undefined;
}

/** One in-process request through `app.request()`, with its body read and parsed. */
export async function requestJson<T = unknown>(
  app: Requestable,
  method: string,
  path: string,
  request: JsonRequest = {},
): Promise<JsonResponse<T>> {
  const headers: Record<string, string> = { accept: 'application/json', ...request.headers };
  const init: RequestInit = { method, headers };
  if (request.body !== undefined) {
    headers['content-type'] ??= 'application/json';
    init.body = JSON.stringify(request.body);
  }
  const res = await app.request(path, init);
  const text = await res.text();
  const json = (res.headers.get('content-type') ?? '').includes('json');
  const body = text === '' ? null : json ? JSON.parse(text) : text;
  return { status: res.status, body: body as T, headers: res.headers };
}

/** `GET path`, parsed: `const { status, body } = await getJson(t.app, '/healthz')`. */
export function getJson<T = unknown>(
  app: Requestable,
  path: string,
  headers?: Readonly<Record<string, string>>,
): Promise<JsonResponse<T>> {
  return requestJson<T>(app, 'GET', path, { headers });
}

/** `POST path` with a JSON body, parsed. */
export function postJson<T = unknown>(
  app: Requestable,
  path: string,
  body: unknown,
  headers?: Readonly<Record<string, string>>,
): Promise<JsonResponse<T>> {
  return requestJson<T>(app, 'POST', path, { body, headers });
}
