import { isIdentityProviderError } from '@mwc/identity-core';
import type { ClerkBackendApi, Page } from './client.ts';
import { DEFAULT_RETRY_AFTER_MS, toIdentityError } from './errors.ts';
import type { RateBucket, RateGate } from './rate-limit.ts';

/**
 * How the connector calls the Backend API: each call behind the rate gate with its failure mapped to an
 * `IdentityProviderError` (a 429 closes the bucket for its Retry-After), 404s as null where the port
 * wants a lookup or an idempotent removal, and paged lists read to the end.
 */
export class ClerkCalls {
  readonly #api: ClerkBackendApi;
  readonly #gate: RateGate;
  readonly #pageSize: number;

  constructor(api: ClerkBackendApi, gate: RateGate, pageSize: number) {
    this.#api = api;
    this.#gate = gate;
    this.#pageSize = pageSize;
  }

  /** One Backend API call behind the rate gate, with its failure mapped. */
  async call<T>(operation: string, run: (api: ClerkBackendApi) => Promise<T>, bucket: RateBucket = 'api') {
    this.#gate.check(bucket);
    try {
      return await run(this.#api);
    } catch (error) {
      const mapped = toIdentityError(error, operation);
      if (mapped.code === 'rate_limited')
        this.#gate.block(bucket, mapped.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS);
      throw mapped;
    }
  }

  /** The same, resolving null for a 404 (a lookup of nothing, an idempotent removal). */
  async callOrNull<T>(operation: string, run: (api: ClerkBackendApi) => Promise<T>): Promise<T | null> {
    try {
      return await this.call(operation, run);
    } catch (error) {
      if (isIdentityProviderError(error, 'not_found')) return null;
      throw error;
    }
  }

  /** Every item of a paged list, fetching page after page until Clerk's total is reached. */
  async *pages<T>(
    operation: string,
    fetchPage: (api: ClerkBackendApi, offset: number, limit: number) => Promise<Page<T>>,
  ): AsyncGenerator<T> {
    for (let offset = 0; ; ) {
      const page = await this.call(operation, (api) => fetchPage(api, offset, this.#pageSize));
      yield* page.data;
      offset += page.data.length;
      if (page.data.length === 0 || offset >= page.totalCount) return;
    }
  }
}
