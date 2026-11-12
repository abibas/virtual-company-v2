import type { ToolFailure } from '../../rules/tools.ts';
import { type ProviderFetch, providerCall, readObject } from '../usage/http.ts';

/**
 * What the tool checks share with the usage checks (`usage/http.ts`): every call goes through the injected `fetch` to a
 * fixed address, with redirects refused and the same deadline, and its answer is read as one bounded JSON object. A
 * token or a provider's answer never leaves the check: a failure is a code.
 */

/** A check that could not tell who the sign-in is. */
export interface Failed {
  readonly ok: false;
  readonly code: ToolFailure;
}

export const failed = (code: ToolFailure): Failed => ({ ok: false, code });

/** A provider's answer, with its body read as one JSON object on request (undefined when it is not one). */
export type Answer =
  | {
      readonly ok: true;
      readonly response: Response;
      read(): Promise<Record<string, unknown> | undefined>;
    }
  | Failed;

/** One call to a provider; a network failure or a timeout is `provider_unavailable`. */
export async function answerOf(fetchFn: ProviderFetch, url: string, init: RequestInit): Promise<Answer> {
  let response: Response;
  try {
    response = await providerCall(fetchFn, url, init);
  } catch {
    return failed('provider_unavailable');
  }
  return { ok: true, response, read: () => readObject(response).catch(() => undefined) };
}
