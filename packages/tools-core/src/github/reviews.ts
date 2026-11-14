/**
 * Pull request reviews through the GitHub port (2026-11-14, docs/subscriptions.md "GitHub tools"): a review made with an
 * event (or left pending), its line comments, a comment added to a pending review, and a pending review submitted. A
 * review is never dismissed here, and nothing merges or closes a pull request.
 */

/** What a review does when it is submitted: GitHub's events. */
export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

/** The side of a diff a line comment is on: the old file (`LEFT`) or the new one (`RIGHT`). */
export type DiffSide = 'LEFT' | 'RIGHT';

/** A comment on a line (or, with `startLine`, a range of lines) of a pull request's diff, made with its review. */
export interface ReviewLineComment {
  readonly path: string;
  readonly body: string;
  /** The line, or a range's last line. */
  readonly line: number;
  readonly side?: DiffSide | undefined;
  readonly startLine?: number | undefined;
  readonly startSide?: DiffSide | undefined;
}

/** A new review: submitted with `event`, else left pending (only its author sees it until it is submitted). */
export interface NewReview {
  readonly event?: ReviewEvent | undefined;
  readonly body?: string | undefined;
  /** The commit reviewed; the pull request's head when left out. */
  readonly commitId?: string | undefined;
  readonly comments?: readonly ReviewLineComment[] | undefined;
}

/** A comment added to a pending review: on a file (`FILE`) or on a line or range of it (`LINE`). */
export interface PendingReviewComment {
  readonly path: string;
  readonly body: string;
  readonly subjectType: 'FILE' | 'LINE';
  readonly line?: number | undefined;
  readonly side?: DiffSide | undefined;
  readonly startLine?: number | undefined;
  readonly startSide?: DiffSide | undefined;
}

/** A comment thread a pending review got: its GraphQL id (`PRRT_…`) and its first comment's address. */
export interface GitHubReviewThread {
  readonly id: string;
  readonly url: string | null;
}
