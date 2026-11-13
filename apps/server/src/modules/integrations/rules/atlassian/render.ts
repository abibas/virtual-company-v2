import type { ConfluencePage, JiraIssue } from '@mwc/tools-core';

/**
 * What an Atlassian tool answers (S7.1c): JSON an agent reads, trimmed to what it needs. Empty fields are left out; a
 * long description, page body or comment is cut with a note of how much was left out; other fields Jira gave are kept
 * short; the whole answer stays under the turn's tool result limit.
 */

/** How much of each long text an answer keeps. */
export const TEXT_LIMITS = {
  /** An issue's description, a page's body. */
  body: 20_000,
  /** A description in a search's list. */
  listed: 500,
  comment: 2_000,
  /** Another field Jira gave, as JSON. */
  extra: 1_000,
} as const;

/** The longest answer: under the tool result's 50 000 characters, with room for its note. */
export const ANSWER_MAX = 48_000;

/** A text cut to `max` characters, saying how many more there were. */
export function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[cut: ${text.length - max} more characters]`;
}

const isEmpty = (value: unknown) =>
  value === null ||
  value === undefined ||
  value === '' ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0);

/** An object without its empty fields. */
export function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => !isEmpty(field))) as Partial<T>;
}

/** Another field's value, short: a string as it is, anything else as JSON, cut. */
const extraValue = (value: unknown): unknown => {
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return cut(text, TEXT_LIMITS.extra);
};

/** An issue as an answer shows it; `listed` keeps its description short, as a search's list does. */
export function issueView(issue: JiraIssue, listed = false) {
  const { description, comments, commentsTotal, extra, ...fields } = issue;
  return compact({
    ...fields,
    description:
      description === null ? null : cut(description, listed ? TEXT_LIMITS.listed : TEXT_LIMITS.body),
    comments: comments.map((comment) =>
      compact({ ...comment, body: cut(comment.body, TEXT_LIMITS.comment) }),
    ),
    commentsShown:
      comments.length > 0 && commentsTotal > comments.length
        ? `the latest ${comments.length} of ${commentsTotal}`
        : null,
    fields: Object.fromEntries(Object.entries(extra).map(([name, value]) => [name, extraValue(value)])),
  });
}

/** A page as an answer shows it. */
export const pageView = (page: ConfluencePage) =>
  compact({ ...page, body: cut(page.body, TEXT_LIMITS.body) });

/** The answer's text: its JSON, cut to `ANSWER_MAX` (ask for less, or a page at a time). */
export function answer(value: unknown): string {
  const text = JSON.stringify(value, null, 1);
  if (text.length <= ANSWER_MAX) return text;
  return `${text.slice(0, ANSWER_MAX)}\n…[cut: the answer was ${text.length} characters; ask for fewer results or fields]`;
}
