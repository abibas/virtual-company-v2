/**
 * The limits tests' world (S3.3): a fake AI provider, a `fetch` that answers each provider address from queued or
 * standing answers and records every call, so no test reaches a real provider; a test app wired to it; the logins as
 * the sign-in helper will store them; and the limits API as someone.
 */
import { credentialUses, type DbHandle } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { requestJson } from '@mwc/testkit';
import { asc, eq } from 'drizzle-orm';
import { credentialSecrets } from '../../../src/modules/credentials/index.ts';
import type { SubscriptionLimits } from '../../../src/modules/credentials/schemas/limits.ts';
import { ephemeralKeyring } from '../../../src/platform/secrets/keyring.ts';
import type { LinkedUser } from '../companies/companies.ts';
import { type AuthWorld, authWorld, bearer } from '../platform/auth.ts';

/** The provider addresses the checks call, spelled out here so the tests pin them. */
export const URLS = {
  claudeUsage: 'https://api.anthropic.com/api/oauth/usage',
  claudeToken: 'https://platform.claude.com/v1/oauth/token',
  messages: 'https://api.anthropic.com/v1/messages',
  codexUsage: 'https://chatgpt.com/backend-api/wham/usage',
  codexToken: 'https://auth.openai.com/oauth/token',
} as const;

export interface ProviderCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly redirect: RequestInit['redirect'];
  readonly hasDeadline: boolean;
}

export type Answer = (call: ProviderCall) => Response | Promise<Response>;

/** A JSON answer, made fresh for each call (a Response is read once). */
export const json =
  (status: number, body: unknown, headers: Record<string, string> = {}): Answer =>
  () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });

/** A call's body: its JSON, or its text as sent (Slack's form-encoded arguments, S7.1e). */
function bodyOf(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class FakeProvider {
  readonly calls: ProviderCall[] = [];
  readonly #queued = new Map<string, Answer[]>();
  readonly #standing = new Map<string, Answer>();
  readonly #routes = new Map<string, Answer[]>();

  /** Answers the next call to `url` once, before any standing answer. */
  once(url: string, answer: Answer): this {
    this.#queued.set(url, [...(this.#queued.get(url) ?? []), answer]);
    return this;
  }

  /** Answers every call to `url` that no queued answer takes. */
  always(url: string, answer: Answer): this {
    this.#standing.set(url, answer);
    return this;
  }

  /**
   * Answers the calls of `method` to `url` whatever their query, when neither a queued nor a standing answer takes them
   * (S7.1c: Atlassian's addresses carry queries); a list is answered in turn, its last answer kept.
   */
  route(method: string, url: string, ...answers: Answer[]): this {
    this.#routes.set(`${method} ${url}`, answers);
    return this;
  }

  /** The calls to one address. */
  callsTo(url: string): ProviderCall[] {
    return this.calls.filter((call) => call.url === url);
  }

  /** Forgets the answers and the calls. */
  reset(): void {
    this.calls.length = 0;
    this.#queued.clear();
    this.#standing.clear();
    this.#routes.clear();
  }

  /** A route's next answer for the call (its address without the query). */
  #routed(method: string, url: string): Answer | undefined {
    const answers = this.#routes.get(`${method} ${url.split('?')[0]}`);
    return answers && answers.length > 1 ? answers.shift() : answers?.[0];
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? bodyOf(init.body) : undefined;
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const call = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body,
      redirect: init?.redirect,
      hasDeadline: init?.signal instanceof AbortSignal,
    };
    this.calls.push(call);
    const answer =
      this.#queued.get(url)?.shift() ?? this.#standing.get(url) ?? this.#routed(call.method, url);
    if (answer === undefined) throw new Error(`The fake provider has no answer for ${call.method} ${url}`);
    return answer(call);
  };
}

export interface LimitsWorld extends AuthWorld {
  readonly provider: FakeProvider;
  readonly store: ReturnType<typeof credentialSecrets>;
}

/** A test app whose usage checks call a fake provider, with the store on the same keyring and clock. */
export async function limitsWorld(): Promise<LimitsWorld> {
  const keyring = ephemeralKeyring();
  const provider = new FakeProvider();
  const w = await authWorld({ keyring, providerFetch: provider.fetch });
  return { ...w, provider, store: credentialSecrets({ db: w.t.db, keyring, clock: w.clock }) };
}

/** `GET /api/me/subscriptions/limits[?query]` as the holder of `token`. */
export async function getLimits(w: AuthWorld, token: string, query = '') {
  const res = await requestJson(w.t.app, 'GET', `/api/me/subscriptions/limits${query}`, {
    headers: bearer(token),
  });
  return { status: res.status, body: res.body as { limits: SubscriptionLimits[] } & Record<string, unknown> };
}

/** The caller's limits, by credential id (the test fails on anything but a 200). */
export async function limitsOf(w: AuthWorld, user: LinkedUser, query = '') {
  const res = await getLimits(w, user.token, query);
  if (res.status !== 200) throw new Error(`GET limits answered ${res.status}: ${JSON.stringify(res.body)}`);
  return new Map(res.body.limits.map((entry) => [entry.credentialId, entry]));
}

/** A Claude login as the sign-in helper stores it: Claude Code's token set and its account. */
export function claudeLogin(tokens: {
  readonly accessToken?: string;
  readonly refreshToken?: string;
  readonly expiresAt?: number;
  readonly scopes?: string[];
}) {
  return {
    credentials: { claudeAiOauth: { subscriptionType: 'max', ...tokens } },
    account: { emailAddress: 'ihor@example.com', organizationName: 'Ihor' },
  };
}

/** An OpenAI login as the sign-in helper stores it: Codex's `auth.json`. */
export function codexLogin(tokens: {
  readonly access_token?: string;
  readonly refresh_token?: string;
  readonly id_token?: string;
  readonly account_id?: string;
}) {
  return { auth: { OPENAI_API_KEY: null, tokens, last_refresh: '2026-10-12T12:00:00.000Z' } };
}

/** An unsigned JWT with this `exp` (epoch seconds) and a marker in its payload. */
export function jwt(exp: number | undefined, marker = 'access'): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none' })}.${part({ exp, marker })}.sig`;
}

/** A credential's recorded uses, oldest first. */
export const usesOf = (db: DbHandle, id: string) =>
  rawDb(db)
    .select()
    .from(credentialUses)
    .where(eq(credentialUses.credentialId, id))
    .orderBy(asc(credentialUses.id));
