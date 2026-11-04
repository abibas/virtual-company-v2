/**
 * Just enough of Clerk's Frontend API to play an invitee in the opt-in contract run: a dev-browser token
 * (development instances), then a sign-up with the invitation's ticket, which verifies the `+clerk_test`
 * email and accepts the organization invitation in one step. No real email is sent. Tokens stay in memory:
 * nothing here logs them, and failures are described by HTTP status and Clerk error code only.
 */

export interface FapiOptions {
  /** The Frontend API host, e.g. `robust-koala-7286.clerk.accounts.dev`. */
  readonly frontendApi: string;
  /** Sent as `Origin`, so the session token's `azp` is this origin. */
  readonly origin: string;
  /** A Backend API testing token: lets the sign-up past bot protection. */
  readonly testingToken?: string | undefined;
  readonly fetch?: typeof fetch;
}

export type FapiResult<T> = { readonly ok: T } | { readonly unverified: string };

interface ClerkErrors {
  readonly errors?: ReadonlyArray<{
    readonly code?: string;
    readonly long_message?: string;
    readonly message?: string;
  }>;
}

function describeFailure(step: string, status: number, body: unknown): string {
  const first = (body as ClerkErrors | null)?.errors?.[0];
  const detail = first ? ` ${first.code ?? ''}: ${first.long_message ?? first.message ?? ''}` : '';
  return `${step}: HTTP ${status}${detail}`.trim();
}

async function json(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export class Fapi {
  readonly #options: FapiOptions;
  readonly #fetch: typeof fetch;
  #devBrowser: string | undefined;

  constructor(options: FapiOptions) {
    this.#options = options;
    this.#fetch = options.fetch ?? fetch;
  }

  /** Creates the dev browser this client's requests belong to. */
  async start(): Promise<FapiResult<true>> {
    const response = await this.#fetch(`https://${this.#options.frontendApi}/v1/dev_browser`, {
      method: 'POST',
      headers: { origin: this.#options.origin },
    });
    const body = (await json(response)) as { token?: unknown; id?: unknown } | null;
    const token =
      typeof body?.token === 'string' ? body.token : typeof body?.id === 'string' ? body.id : undefined;
    if (!response.ok || token === undefined)
      return { unverified: describeFailure('dev browser', response.status, body) };
    this.#devBrowser = token;
    return { ok: true };
  }

  /** `GET /v1/environment`: the instance's public settings (what the sign-in components read). */
  async environment(): Promise<FapiResult<Record<string, unknown>>> {
    const response = await this.#fetch(this.#url('/v1/environment'), {
      headers: { origin: this.#options.origin },
    });
    const body = await json(response);
    if (!response.ok || body === null)
      return { unverified: describeFailure('environment', response.status, body) };
    return { ok: body as Record<string, unknown> };
  }

  /**
   * Signs up through an invitation ticket. On `complete`, the new user's id and the session token Clerk
   * minted for it (its `azp` is our origin).
   */
  async signUpWithTicket(ticket: string): Promise<FapiResult<{ userId: string; sessionToken?: string }>> {
    const response = await this.#fetch(this.#url('/v1/client/sign_ups'), {
      method: 'POST',
      headers: { origin: this.#options.origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ strategy: 'ticket', ticket }).toString(),
    });
    const body = (await json(response)) as SignUpBody | null;
    if (!response.ok || !body?.response)
      return { unverified: describeFailure('sign-up', response.status, body) };
    const signUp = body.response;
    if (signUp.status !== 'complete' || !signUp.created_user_id) {
      const missing = [...(signUp.missing_fields ?? []), ...(signUp.unverified_fields ?? [])].join(', ');
      return { unverified: `sign-up ended "${signUp.status}"${missing ? ` (needs ${missing})` : ''}` };
    }
    const session = body.client?.sessions?.find((s) => s.id === signUp.created_session_id);
    const sessionToken = session?.last_active_token?.jwt;
    return { ok: { userId: signUp.created_user_id, ...(sessionToken ? { sessionToken } : {}) } };
  }

  #url(path: string): string {
    const url = new URL(`https://${this.#options.frontendApi}${path}`);
    if (this.#devBrowser) url.searchParams.set('__clerk_db_jwt', this.#devBrowser);
    if (this.#options.testingToken) url.searchParams.set('__clerk_testing_token', this.#options.testingToken);
    return url.toString();
  }
}

interface SignUpBody {
  readonly response?: {
    readonly status?: string;
    readonly created_user_id?: string | null;
    readonly created_session_id?: string | null;
    readonly missing_fields?: readonly string[];
    readonly unverified_fields?: readonly string[];
  };
  readonly client?: {
    readonly sessions?: ReadonlyArray<{
      readonly id?: string;
      readonly last_active_token?: { readonly jwt?: string };
    }>;
  };
}
