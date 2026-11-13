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

/** What went wrong in a GitHub call (S7.1d): the same codes as Atlassian's. */
export const GITHUB_ERROR_CODES = ATLASSIAN_ERROR_CODES;
export type GitHubErrorCode = AtlassianErrorCode;

/** The words for each code, the start of a GitHub error's message. */
export const GITHUB_ERROR_MESSAGES: Readonly<Record<GitHubErrorCode, string>> = {
  needs_sign_in:
    'GitHub refused the sign-in (401): its owner needs to sign in again on the Subscriptions page.',
  forbidden: 'GitHub says the account has no permission for this (403).',
  not_found: 'GitHub found nothing there, or the account cannot see it (404).',
  bad_request: 'GitHub refused the request as written.',
  conflict: 'GitHub says it conflicts with how things are now (409).',
  rate_limited: 'GitHub is limiting requests.',
  unavailable: 'GitHub did not answer; try again shortly.',
  invalid_response: 'GitHub gave an answer that could not be read.',
};

/** The one error every `GitHubApi` method rejects with: its code, HTTP status and words (never the token). */
export class GitHubError extends Error {
  readonly code: GitHubErrorCode;
  readonly status: number | null;

  constructor(
    code: GitHubErrorCode,
    options: { readonly status?: number | null; readonly detail?: string | undefined } = {},
  ) {
    const words = GITHUB_ERROR_MESSAGES[code];
    super(options.detail ? `${words} ${options.detail}` : words);
    this.name = 'GitHubError';
    this.code = code;
    this.status = options.status ?? null;
  }
}

export const isGitHubError = (error: unknown): error is GitHubError => error instanceof GitHubError;

/**
 * What went wrong in a Slack call (S7.1e): Atlassian's codes and `not_in_channel` (a bot reading or posting in a channel
 * it was not invited to). Slack answers most refusals with HTTP 200 and `{ok: false, error}`; the connector maps that
 * error here and keeps it as `slackError` (`missing_scope`, `channel_not_found`, …).
 */
export const SLACK_ERROR_CODES = [...ATLASSIAN_ERROR_CODES, 'not_in_channel'] as const;
export type SlackErrorCode = (typeof SLACK_ERROR_CODES)[number];

/** The words for each code, the start of a Slack error's message. */
export const SLACK_ERROR_MESSAGES: Readonly<Record<SlackErrorCode, string>> = {
  needs_sign_in:
    'Slack refused the token (invalid or revoked): its owner needs to add it again on the Subscriptions page.',
  forbidden: 'Slack says the token may not do this.',
  not_found: 'Slack found nothing there, or the token cannot see it.',
  bad_request: 'Slack refused the request as written.',
  conflict: 'Slack says it conflicts with how things are now.',
  rate_limited: 'Slack is limiting requests.',
  unavailable: 'Slack did not answer; try again shortly.',
  invalid_response: 'Slack gave an answer that could not be read.',
  not_in_channel: 'The bot is not in this channel: invite the bot to it in Slack (/invite), then try again.',
};

/** The one error every `SlackApi` method rejects with: its code, Slack's own error, HTTP status and words. */
export class SlackError extends Error {
  readonly code: SlackErrorCode;
  /** Slack's own `error` (`missing_scope`, `channel_not_found`); null when Slack said none (an outage). */
  readonly slackError: string | null;
  readonly status: number | null;
  /** A rate limit's wait before trying again, in ms (its `Retry-After`); null for any other error. */
  readonly retryAfterMs: number | null;

  constructor(
    code: SlackErrorCode,
    options: {
      readonly slackError?: string | null;
      readonly status?: number | null;
      readonly detail?: string | undefined;
      readonly retryAfterMs?: number | null;
    } = {},
  ) {
    const words = SLACK_ERROR_MESSAGES[code];
    super(options.detail ? `${words} ${options.detail}` : words);
    this.name = 'SlackError';
    this.code = code;
    this.slackError = options.slackError ?? null;
    this.status = options.status ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

export const isSlackError = (error: unknown): error is SlackError => error instanceof SlackError;
