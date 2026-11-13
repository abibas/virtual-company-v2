import type { ConfluencePage, JiraIssue } from '@mwc/tools-core';
import { compact, cut } from '../answer.ts';

export { ANSWER_BYTES, ANSWER_MAX, answer, compact, cut } from '../answer.ts';

/**
 * What an Atlassian tool answers (S7.1c): JSON an agent reads, trimmed to what it needs. Empty fields are left out; a
 * long description, page body or comment is cut with a note of how much was left out; other fields Jira gave are kept
 * short; the whole answer stays under the turn's tool result limit, and under the runner's socket line once it is
 * escaped as JSON and written as UTF-8 (64 KB: a long answer in Cyrillic or full of quotes would pass the characters'
 * limit and not that one).
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
