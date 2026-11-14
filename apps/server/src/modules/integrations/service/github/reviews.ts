import type { GitHubReview, RepoName } from '@mwc/tools-core';
import { reviewView } from '../../rules/github/render.ts';
import { judgesPull, ownPullWords, reviewEventRefusal } from '../../rules/github/rights.ts';
import type { GitHubInput } from '../../schemas/github.ts';
import { done, excerpt, refused, type ToolReply } from '../reply.ts';
import { type GitHubContext, pullId, repoOf } from './context.ts';

/**
 * The review tools (2026-11-14, docs/subscriptions.md "GitHub tools"), with the `reviews` right: a review made with an
 * event and its line comments, or left pending; the account's pending review submitted with an event, or deleted; a
 * comment added to it. APPROVE and REQUEST_CHANGES need `approve`, and never go on the account's own pull request (its
 * author is the sign-in's login, read from GitHub). Each one is audited as the agent on `owner/repo#n`, and answers with
 * the review's address. Nothing merges, closes or dismisses a review. The repository was checked against the allowlist
 * before any of these runs (`call.ts`).
 */

/** How many pages of a pull request's reviews are looked through for the account's pending one. */
const REVIEW_PAGES = 3;

export const noPending = (pull: string, login: string) =>
  `${login} has no pending review on ${pull}: make one with pull_request_review_write method create and no event.`;

/** Why the review's event is refused (the right, or the account's own pull request), or undefined. */
async function eventRefusal(
  ctx: GitHubContext,
  repo: RepoName,
  number: number,
  event: string | undefined,
): Promise<string | undefined> {
  const right = reviewEventRefusal(event, ctx.rights);
  if (right !== undefined || !judgesPull(event)) return right;
  const login = await ctx.api.viewerLogin(ctx.signIn);
  const pull = await ctx.api.getPullRequest(ctx.signIn, repo, number);
  const own = pull.author !== null && pull.author.toLowerCase() === login.toLowerCase();
  return own ? ownPullWords(pullId(repo, number), login, event as string) : undefined;
}

/** The account's latest pending review of the pull request, with its login. */
async function pendingReview(ctx: GitHubContext, repo: RepoName, number: number) {
  const login = await ctx.api.viewerLogin(ctx.signIn);
  let found: GitHubReview | undefined;
  for (let page = 1; page <= REVIEW_PAGES; page++) {
    const reviews = await ctx.api.listReviews(ctx.signIn, repo, number, { page, perPage: 100 });
    const mine = reviews.filter(
      (review) => review.state === 'PENDING' && review.author?.toLowerCase() === login.toLowerCase(),
    );
    found = mine.at(-1) ?? found;
    if (reviews.length < 100) break;
  }
  return { login, review: found };
}

/** What a review's audit row says of it: `<id>: <state>`. */
const reviewWords = (review: GitHubReview, state = review.state) => `${review.id}: ${state}`;

async function create(ctx: GitHubContext, input: GitHubInput<'pull_request_review_write'>, repo: RepoName) {
  const { event, body, commitID, comments } = input;
  const refusal = await eventRefusal(ctx, repo, input.pullNumber, event);
  if (refusal !== undefined) return refused(refusal);
  const review = await ctx.api.createReview(ctx.signIn, repo, input.pullNumber, {
    event,
    body,
    commitId: commitID,
    comments,
  });
  await ctx.audit({
    entityId: pullId(repo, input.pullNumber),
    changes: [
      { field: 'review', new: reviewWords(review, event ?? 'PENDING') },
      ...(body === undefined || body === '' ? [] : [{ field: 'body', new: excerpt(body) }]),
      ...(comments === undefined ? [] : [{ field: 'comments', new: comments.length }]),
    ],
  });
  const pending = event === undefined;
  return done({
    pullRequest: pullId(repo, input.pullNumber),
    review: reviewView(review),
    ...(comments === undefined ? {} : { comments: comments.length }),
    ...(pending ? { note: 'Pending: submit it with pull_request_review_write method submit_pending.' } : {}),
  });
}

async function submit(ctx: GitHubContext, input: GitHubInput<'pull_request_review_write'>, repo: RepoName) {
  const event = input.event as NonNullable<typeof input.event>;
  const id = pullId(repo, input.pullNumber);
  const refusal = await eventRefusal(ctx, repo, input.pullNumber, event);
  if (refusal !== undefined) return refused(refusal);
  const { login, review } = await pendingReview(ctx, repo, input.pullNumber);
  if (review === undefined) return refused(noPending(id, login));
  const sent = { event, body: input.body };
  const submitted = await ctx.api.submitReview(ctx.signIn, repo, input.pullNumber, review.id, sent);
  await ctx.audit({
    entityId: id,
    changes: [
      { field: 'review', old: reviewWords(review), new: reviewWords(review, event) },
      ...(input.body === undefined || input.body === '' ? [] : [{ field: 'body', new: excerpt(input.body) }]),
    ],
  });
  return done({ pullRequest: id, review: reviewView(submitted) });
}

async function remove(ctx: GitHubContext, input: GitHubInput<'pull_request_review_write'>, repo: RepoName) {
  const id = pullId(repo, input.pullNumber);
  const { login, review } = await pendingReview(ctx, repo, input.pullNumber);
  if (review === undefined) return refused(noPending(id, login));
  await ctx.api.deletePendingReview(ctx.signIn, repo, input.pullNumber, review.id);
  await ctx.audit({ entityId: id, changes: [{ field: 'review', old: reviewWords(review), new: 'deleted' }] });
  return done({ pullRequest: id, deleted: reviewView(review) });
}

/** `pull_request_review_write`: create, submit_pending or delete_pending. */
async function reviewWrite(
  ctx: GitHubContext,
  input: GitHubInput<'pull_request_review_write'>,
): Promise<ToolReply> {
  const repo = repoOf(input);
  if (input.method === 'create') return create(ctx, input, repo);
  return input.method === 'submit_pending' ? submit(ctx, input, repo) : remove(ctx, input, repo);
}

/** `add_comment_to_pending_review`: a comment on a file or a line, in the account's pending review. */
async function commentInPending(ctx: GitHubContext, input: GitHubInput<'add_comment_to_pending_review'>) {
  const repo = repoOf(input);
  const id = pullId(repo, input.pullNumber);
  const { login, review } = await pendingReview(ctx, repo, input.pullNumber);
  if (review === undefined || review.nodeId === null) return refused(noPending(id, login));
  const { path, body, subjectType, line, side, startLine, startSide } = input;
  const comment = { path, body, subjectType, line, side, startLine, startSide };
  const thread = await ctx.api.addPendingReviewComment(ctx.signIn, review.nodeId, comment);
  const at = line === undefined ? path : `${path}:${startLine === undefined ? '' : `${startLine}-`}${line}`;
  await ctx.audit({ entityId: id, changes: [{ field: 'comment', new: `${review.id} ${at}: ${excerpt(body)}` }] });
  return done({
    pullRequest: id,
    review: reviewView(review),
    comment: thread.url,
    note: 'Pending: submit the review with pull_request_review_write method submit_pending.',
  });
}

export const REVIEW_TOOLS = {
  pull_request_review_write: reviewWrite,
  add_comment_to_pending_review: commentInPending,
};
