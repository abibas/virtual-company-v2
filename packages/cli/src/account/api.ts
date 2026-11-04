/** The one API call the account commands make, `GET /api/me` with a personal API key, through an injected fetch. */

/** `fetch` as the commands use it; tests pass a fake. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** One company of the caller, as `GET /api/me` lists it (an API key sees its own company only). */
export interface MeMembership {
  readonly companyId: string;
  readonly slug: string;
  readonly name: string;
  readonly role: string;
  readonly status: string;
}

/** The part of `GET /api/me` the commands read. */
export interface Me {
  readonly user: { readonly id: string; readonly email: string; readonly displayName: string };
  readonly memberships: readonly MeMembership[];
  readonly session: { readonly via: string };
}

export type MeResult =
  | { readonly ok: true; readonly me: Me }
  | {
      readonly ok: false;
      /** The HTTP status, or 0 when the server could not be reached or did not answer like this API. */
      readonly status: number;
      readonly code: string;
      readonly message: string;
    };

/** How long a call may take. */
export const API_TIMEOUT_MS = 15_000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function isMe(body: unknown): body is Me {
  return (
    isObject(body) &&
    isObject(body.user) &&
    typeof body.user.id === 'string' &&
    Array.isArray(body.memberships) &&
    body.memberships.every(
      (m) => isObject(m) && typeof m.companyId === 'string' && typeof m.slug === 'string',
    ) &&
    isObject(body.session)
  );
}

/** The error body's code and message (`{ error: { code, message } }`), or ones made from the status. */
async function failure(res: Response): Promise<MeResult> {
  const body: unknown = await res.json().catch(() => undefined);
  const error = isObject(body) && isObject(body.error) ? body.error : {};
  return {
    ok: false,
    status: res.status,
    code: typeof error.code === 'string' ? error.code : `http_${res.status}`,
    message: typeof error.message === 'string' ? error.message : `the server answered ${res.status}`,
  };
}

/** `GET <server>/api/me` with the key as the bearer: who it acts as, and in which company. */
export async function getMe(fetch: Fetch, server: string, key: string): Promise<MeResult> {
  let res: Response;
  try {
    res = await fetch(`${server}/api/me`, {
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
  if (res.status !== 200) return failure(res);
  const body: unknown = await res.json().catch(() => undefined);
  if (!isMe(body)) {
    return {
      ok: false,
      status: 0,
      code: 'bad_response',
      message: `${server} does not answer like the mwc API`,
    };
  }
  return { ok: true, me: body };
}
