/** What went wrong in an Atlassian call; callers branch on `code`, never on messages. */
export const ATLASSIAN_ERROR_CODES = [
  /** 401: the sign-in's API token no longer works; its owner signs in again. */
  'needs_sign_in',
  /** 403: the account may not do this in Atlassian. */
  'forbidden',
  /** 404: no such issue, page or space, or the account cannot see it. */
  'not_found',
  /** 400 or 422: Atlassian refused the request as written (a bad JQL or CQL, a field it does not take). */
  'bad_request',
  /** 409: it changed meanwhile (a page's version). */
  'conflict',
  /** 429, still after the retries. */
  'rate_limited',
  /** 5xx, a network failure or no answer in time. */
  'unavailable',
  /** An answer that could not be read, or a redirect. */
  'invalid_response',
] as const;
export type AtlassianErrorCode = (typeof ATLASSIAN_ERROR_CODES)[number];

/** Jira or Confluence: which product the call went to. */
export type AtlassianProduct = 'Jira' | 'Confluence';

/** The words for each code, the start of the error's message. */
export const ATLASSIAN_ERROR_MESSAGES: Readonly<
  Record<AtlassianErrorCode, (product: AtlassianProduct) => string>
> = {
  needs_sign_in: (product) =>
    `${product} refused the Atlassian sign-in (401): its owner needs to sign in again on the Subscriptions page.`,
  forbidden: (product) => `${product} says the Atlassian account has no permission for this (403).`,
  not_found: (product) => `${product} found nothing there, or the Atlassian account cannot see it (404).`,
  bad_request: (product) => `${product} refused the request as written.`,
  conflict: (product) => `${product} says it changed meanwhile (409): read it again, then retry.`,
  rate_limited: (product) => `${product} is limiting requests (429); wait a minute and try again.`,
  unavailable: (product) => `${product} did not answer; try again shortly.`,
  invalid_response: (product) => `${product} gave an answer that could not be read.`,
};

/** The one error every `AtlassianApi` method rejects with: its code, product, HTTP status and words. */
export class AtlassianError extends Error {
  readonly code: AtlassianErrorCode;
  readonly product: AtlassianProduct;
  readonly status: number | null;

  constructor(
    code: AtlassianErrorCode,
    product: AtlassianProduct,
    options: { readonly status?: number | null; readonly detail?: string | undefined } = {},
  ) {
    const words = ATLASSIAN_ERROR_MESSAGES[code](product);
    super(options.detail ? `${words} ${options.detail}` : words);
    this.name = 'AtlassianError';
    this.code = code;
    this.product = product;
    this.status = options.status ?? null;
  }
}

export const isAtlassianError = (error: unknown): error is AtlassianError => error instanceof AtlassianError;
