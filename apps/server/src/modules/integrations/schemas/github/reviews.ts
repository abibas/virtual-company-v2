import { z } from 'zod';
import { BODY_MAX, number, pull } from './fields.ts';

/**
 * The GitHub review tools' names and inputs (2026-11-14, docs/subscriptions.md "GitHub tools"), as GitHub's MCP server's
 * README and source named them that day: `pull_request_review_write` makes a review (submitted with `event`, else
 * pending), submits the account's pending review or deletes it, and `add_comment_to_pending_review` adds a comment to
 * it. One addition: `create` takes line comments (`comments`), as GitHub's REST does, so a review with comments is one
 * call. Resolving review threads (`resolve_thread`, `unresolve_thread`) is not offered: its `threadId` is refused by name.
 */

export const GITHUB_REVIEW_TOOLS = ['pull_request_review_write', 'add_comment_to_pending_review'] as const;

/** What `pull_request_review_write` does. */
export const REVIEW_METHODS = ['create', 'submit_pending', 'delete_pending'] as const;

/** A review's events: the `reviews` right `comment` gives COMMENT, `approve` all three. */
export const REVIEW_EVENTS = ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'] as const;

/** The most line comments one review makes. */
export const REVIEW_COMMENTS_MAX = 50;

const side = (what: string) =>
  z
    .enum(['LEFT', 'RIGHT'])
    .optional()
    .describe(`${what}: LEFT is the previous state, RIGHT the new state (the default)`);
const path = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .describe('The relative path to the file that needs a comment');
const commentBody = z.string().trim().min(1).max(BODY_MAX).describe('The text of the review comment');
const line = (what: string) => number(what).optional();

/** A range's first line comes before its last. */
const ordered = (comment: { readonly line?: number | undefined; readonly startLine?: number | undefined }) =>
  comment.startLine === undefined || (comment.line !== undefined && comment.startLine <= comment.line);
const RANGE = 'startLine needs line, and comes before it';

const lineComment = z
  .object({
    path,
    body: commentBody,
    line: number('The line of the file in the pull request diff (a range’s last line)'),
    side: side('The side of the diff'),
    startLine: line('For a comment on several lines, the first line of the range'),
    startSide: side('For a comment on several lines, the side of its first line'),
  })
  .refine(ordered, RANGE);

const reviewWrite = z
  .object({
    method: z.enum(REVIEW_METHODS).describe(`The write operation: ${REVIEW_METHODS.join(', ')}`),
    ...pull,
    body: z.string().max(BODY_MAX).optional().describe('Review comment text'),
    event: z
      .enum(REVIEW_EVENTS)
      .optional()
      .describe('Review action: with create it submits the review (left out, the review stays pending)'),
    commitID: z.string().trim().min(1).max(64).optional().describe('SHA of commit to review'),
    comments: z
      .array(lineComment)
      .max(REVIEW_COMMENTS_MAX)
      .optional()
      .describe('With create: line comments of the review (path, line, side, startLine, startSide, body)'),
  })
  .refine((input) => input.method !== 'submit_pending' || input.event !== undefined, {
    message: 'submit_pending needs an event',
    path: ['event'],
  })
  .refine((input) => input.method === 'create' || input.comments === undefined, {
    message: 'comments go with create; add_comment_to_pending_review adds one to a pending review',
    path: ['comments'],
  })
  .refine(
    (input) =>
      input.method !== 'delete_pending' ||
      [input.event, input.body, input.commitID].every((field) => field === undefined),
    { message: 'delete_pending takes no event, body or commitID', path: ['method'] },
  );

const pendingComment = z
  .object({
    ...pull,
    path,
    body: commentBody,
    subjectType: z.enum(['FILE', 'LINE']).describe('The level at which the comment is targeted'),
    line: line('The line of the blob in the pull request diff that the comment applies to (a range’s last)'),
    side: side('The side of the diff to comment on'),
    startLine: line('For multi-line comments, the first line of the range that the comment applies to'),
    startSide: side('For multi-line comments, the starting side of the diff that the comment applies to'),
  })
  .refine((input) => input.subjectType !== 'LINE' || input.line !== undefined, {
    message: 'a LINE comment needs line',
    path: ['line'],
  })
  .refine(ordered, { message: RANGE, path: ['startLine'] });

/** Each review tool's input. */
export const REVIEW_INPUTS = {
  pull_request_review_write: reviewWrite,
  add_comment_to_pending_review: pendingComment,
};

const THREADS =
  'Resolving review threads is not offered here: create, submit_pending and delete_pending are.';

/** Arguments of GitHub's MCP server's review tools that would do something not offered, refused by name. */
export const REVIEW_REFUSED_ARGUMENTS = {
  pull_request_review_write: { threadId: THREADS, resolutionReason: THREADS },
};
