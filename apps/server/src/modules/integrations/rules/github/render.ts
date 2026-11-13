import type {
  GitHubComment,
  GitHubCommit,
  GitHubContents,
  GitHubFile,
  GitHubIssueHit,
  GitHubPull,
  GitHubPullSummary,
  GitHubReview,
} from '@mwc/tools-core';
import { compact, cut } from '../answer.ts';

/**
 * What a GitHub tool answers (S7.1d): JSON an agent reads, trimmed to what it needs (`../answer.ts` keeps the whole under
 * the tool result's limit). Empty fields are left out; a pull request's or issue's body, a comment, a patch, a diff and
 * a file's text are cut with a note of how much was left out.
 */

/** How much of each long text an answer keeps. */
export const GITHUB_TEXT_LIMITS = {
  /** A pull request's or issue's body when it is read. */
  body: 20_000,
  /** A body in a list or search. */
  listed: 500,
  comment: 2_000,
  /** One file's patch in a list of files. */
  patch: 3_000,
  /** A pull request's whole diff, a file's text. */
  diff: 40_000,
} as const;

const shortBody = (body: string | null, max: number) => (body === null ? null : cut(body, max));

/** A pull request as a list shows it. */
export const pullSummaryView = (pull: GitHubPullSummary) => compact({ ...pull });

/** A pull request read whole. */
export function pullView(pull: GitHubPull) {
  const { nodeId: _, ...fields } = pull;
  return compact({ ...fields, body: shortBody(pull.body, GITHUB_TEXT_LIMITS.body) });
}

/** An issue or pull request in a search or a list; `whole` keeps its body long, as reading one does. */
export const issueView = (issue: GitHubIssueHit, whole = false) =>
  compact({
    ...issue,
    body: shortBody(issue.body, whole ? GITHUB_TEXT_LIMITS.body : GITHUB_TEXT_LIMITS.listed),
  });

export const commentView = (comment: GitHubComment | GitHubReview) =>
  compact({ ...comment, body: cut(comment.body, GITHUB_TEXT_LIMITS.comment) });

export const fileView = (file: GitHubFile) =>
  compact({ ...file, patch: shortBody(file.patch, GITHUB_TEXT_LIMITS.patch) });

export const commitView = (commit: GitHubCommit) =>
  compact({
    ...commit,
    message: cut(commit.message, GITHUB_TEXT_LIMITS.comment),
    files: commit.files.map(fileView),
  });

/** A pull request's diff, cut. */
export const diffView = (diff: string) => ({ diff: cut(diff, GITHUB_TEXT_LIMITS.diff) });

/** A file's text (cut) or a folder's entries; a file that is not text says so. */
export function contentsView(contents: GitHubContents) {
  if (contents.kind === 'dir') return contents;
  const { text, ...file } = contents;
  return text === null
    ? { ...file, text: null, note: 'Not shown: it is not text, or over the 1 MB GitHub sends.' }
    : { ...file, text: cut(text, GITHUB_TEXT_LIMITS.diff) };
}
