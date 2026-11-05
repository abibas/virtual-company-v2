import type { Config } from '@mwc/shared/config';
import { codeOfStatus, members, type UsageErrorCode } from '../../rules/limits.ts';
import type { LimitWindow } from '../../schemas/limits.ts';
import type { SecretOf } from '../../schemas/secrets.ts';

export type { LimitWindow, LimitWindowId } from '../../schemas/limits.ts';

/**
 * What the usage checks share (S3.3): every call to a provider goes through an injected `fetch` (tests pass a fake
 * provider) to a fixed address, with redirects refused and a short deadline, and its answer is read as one bounded
 * JSON object. A provider's answer, error or token never leaves the check: a failure is a code.
 */

/** How the server calls an AI provider: `fetch`, injected (`AppDeps.providerFetch`). */
export type ProviderFetch = typeof fetch;

/** The deadline of one provider call, headers and body. */
export const PROVIDER_TIMEOUT_MS = 10_000;

/** The largest answer read, in characters; a usage answer is a few hundred. */
export const MAX_ANSWER_LENGTH = 256 * 1024;

/** The secrets the checks read: a Claude login, an OpenAI login, a setup-token. */
export type ClaudeLogin = SecretOf<'claude_oauth'>;
export type CodexLogin = SecretOf<'codex_oauth'>;
export type SetupTokenSecret = SecretOf<'claude_setup_token'>;

/** What a check found: the windows, or why there are none. */
export type UsageOutcome =
  | { readonly ok: true; readonly windows: LimitWindow[] }
  | { readonly ok: false; readonly code: UsageErrorCode; readonly retryAfter?: string };

/** Why a check stopped, thrown inside a check and turned into its outcome at its end; a 429 keeps its `Retry-After`. */
export class UsageFailure extends Error {
  readonly code: UsageErrorCode;
  readonly retryAfter: string | undefined;

  constructor(code: UsageErrorCode, retryAfter?: string | null) {
    super(code);
    this.name = 'UsageFailure';
    this.code = code;
    this.retryAfter = retryAfter ?? undefined;
  }
}

/** A refused answer's failure: its status's code, with the `Retry-After` of a 429. */
export const statusFailure = (response: Response): UsageFailure =>
  new UsageFailure(
    codeOfStatus(response.status),
    response.status === 429 ? response.headers.get('retry-after') : undefined,
  );

/** What a login's check needs: the provider, the clock, and a way to store a refreshed token set. */
export interface CheckContext {
  readonly fetch: ProviderFetch;
  readonly clock: () => Date;
}

/** A login's check: also stores the token set it refreshed (sealed again by the credentials module). */
export interface LoginContext<K extends 'claude_oauth' | 'codex_oauth'> extends CheckContext {
  readonly reseal: (secret: SecretOf<K>) => Promise<void>;
}

/** One call to a provider: no redirects, the deadline; a network failure or a timeout is `provider_unavailable`. */
export async function providerCall(
  fetchFn: ProviderFetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetchFn(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch {
    throw new UsageFailure('provider_unavailable');
  }
}

/** Lets go of an answer whose body is not read (its headers were all that mattered, or it was a refusal). */
export async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

/** An answer's body as one JSON object, at most MAX_ANSWER_LENGTH long; anything else is `invalid_response`. */
export async function readObject(response: Response): Promise<Record<string, unknown>> {
  let body: string;
  try {
    body = await response.text();
  } catch {
    throw new UsageFailure('provider_unavailable');
  }
  if (body.length > MAX_ANSWER_LENGTH) throw new UsageFailure('invalid_response');
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new UsageFailure('invalid_response');
  }
  if (members(parsed) !== parsed) throw new UsageFailure('invalid_response');
  return parsed as Record<string, unknown>;
}

/** Runs a check's steps, turning a `UsageFailure` into its outcome; anything else is a bug and is thrown. */
export async function outcomeOf(steps: () => Promise<LimitWindow[]>): Promise<UsageOutcome> {
  try {
    return { ok: true, windows: await steps() };
  } catch (error) {
    if (error instanceof UsageFailure) {
      const { code, retryAfter } = error;
      return retryAfter === undefined ? { ok: false, code } : { ok: false, code, retryAfter };
    }
    throw error;
  }
}

/** Whether a token that expires at `expiresAt` (epoch ms) is expired or will be within the margin. */
export const expiresSoon = (expiresAt: number | undefined, now: Date, marginMs = 5 * 60_000) =>
  expiresAt !== undefined && expiresAt - marginMs <= now.getTime();

/** A refused refresh means signing in again; a rate limit (with its `Retry-After`) or an outage is a failed check. */
export function refreshFailure(status: number, retryAfter?: string | null): UsageFailure {
  if (status === 429) return new UsageFailure('rate_limited', retryAfter);
  if (status >= 500) return new UsageFailure('provider_unavailable');
  return new UsageFailure('needs_sign_in');
}

/** A login's steps: its access token and expiry, its refresh (sealing the new set), its usage call and answer. */
export interface LoginSteps<S> {
  readonly accessToken: (login: S) => string | undefined;
  /** Epoch ms; undefined when the login does not say. */
  readonly expiresAt: (login: S) => number | undefined;
  readonly refresh: (login: S) => Promise<S>;
  readonly usage: (login: S) => Promise<Response>;
  readonly windows: (body: Record<string, unknown>) => LimitWindow[];
}

/**
 * A login's check: no access token means signing in again; one expired or about to be is refreshed first; a 401 with
 * a token not refreshed yet refreshes once and asks again; any other refusal is its code (a second 401: sign in again).
 */
export function loginCheck<S>(login: S, now: Date, steps: LoginSteps<S>): Promise<UsageOutcome> {
  return outcomeOf(async () => {
    if (!steps.accessToken(login)) throw new UsageFailure('needs_sign_in');
    let current = login;
    let refreshed = false;
    if (expiresSoon(steps.expiresAt(login), now)) {
      current = await steps.refresh(current);
      refreshed = true;
    }
    let response = await steps.usage(current);
    if (response.status === 401 && !refreshed) {
      await discard(response);
      current = await steps.refresh(current);
      response = await steps.usage(current);
    }
    if (!response.ok) {
      await discard(response);
      throw statusFailure(response);
    }
    return steps.windows(await readObject(response));
  });
}

/** Refusing every call: what tests get unless they pass a fake provider, so no test reaches a real one. */
const refuseInTests: ProviderFetch = () =>
  Promise.reject(new Error('No network in tests: pass a fake provider (providerFetch)'));

/** The provider client for this configuration: the platform's `fetch`, or a refusal under NODE_ENV=test. */
export function providerFetchFor(
  config: Pick<Config, 'NODE_ENV'>,
  fetchImpl: ProviderFetch = globalThis.fetch,
): ProviderFetch {
  if (config.NODE_ENV === 'test') return refuseInTests;
  return (input, init) => fetchImpl(input, init);
}
