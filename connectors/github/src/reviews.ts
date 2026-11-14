import { type GitHubApi, GitHubError, type ReviewLineComment } from '@mwc/tools-core';
import type { Request } from './http.ts';
import { recordOf, reviewOf } from './map.ts';
import { graphqlErrors, pullPath } from './pulls.ts';

/**
 * Pull request reviews through GitHub's REST API (2026-11-14): the account the sign-in acts as, a review made with an
 * event or left pending (with its line comments), a pending review submitted or deleted, and (GraphQL, as REST cannot) a
 * comment added to a pending review. Nothing here dismisses a review, merges or closes a pull request.
 */

type ReviewsApi = Pick<
  GitHubApi,
  'viewerLogin' | 'createReview' | 'submitReview' | 'deletePendingReview' | 'addPendingReviewComment'
>;

const ADD_THREAD = `mutation($input: AddPullRequestReviewThreadInput!) {
  addPullRequestReviewThread(input: $input) { thread { id comments(first: 1) { nodes { url } } } }
}`;

/** A line comment as GitHub's REST takes it with a new review. */
const restComment = (comment: ReviewLineComment) => ({
  path: comment.path,
  body: comment.body,
  line: comment.line,
  ...(comment.side === undefined ? {} : { side: comment.side }),
  ...(comment.startLine === undefined ? {} : { start_line: comment.startLine }),
  ...(comment.startSide === undefined ? {} : { start_side: comment.startSide }),
});

/** Leaves out the fields not given. */
const given = (fields: Readonly<Record<string, unknown>>) =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));

/** The reviews' part of the port on `request`. */
export const reviewsApi = (request: Request): ReviewsApi => ({
  async viewerLogin(signIn) {
    const login = recordOf(await request(signIn, { method: 'GET', path: '/user' })).login;
    if (typeof login !== 'string' || login === '') throw new GitHubError('invalid_response', { status: 200 });
    return login;
  },
  async createReview(signIn, repo, number, review) {
    const body = given({
      event: review.event,
      body: review.body,
      commit_id: review.commitId,
      comments: review.comments?.map(restComment),
    });
    return reviewOf(await request(signIn, { method: 'POST', path: pullPath(repo, number, '/reviews'), body }));
  },
  async submitReview(signIn, repo, number, reviewId, submit) {
    const path = pullPath(repo, number, `/reviews/${reviewId}/events`);
    const body = given({ event: submit.event, body: submit.body });
    return reviewOf(await request(signIn, { method: 'POST', path, body }));
  },
  async deletePendingReview(signIn, repo, number, reviewId) {
    const path = pullPath(repo, number, `/reviews/${reviewId}`);
    return reviewOf(await request(signIn, { method: 'DELETE', path }));
  },
  async addPendingReviewComment(signIn, reviewNodeId, comment) {
    const input = given({ pullRequestReviewId: reviewNodeId, ...comment });
    const body = { query: ADD_THREAD, variables: { input } };
    const answer = await request(signIn, { method: 'POST', path: '/graphql', body });
    const error = graphqlErrors(answer);
    if (error !== undefined) throw error;
    const added = recordOf(recordOf(recordOf(answer).data).addPullRequestReviewThread);
    const thread = recordOf(added.thread);
    if (typeof thread.id !== 'string') throw new GitHubError('invalid_response', { status: 200 });
    const [first] = Array.isArray(recordOf(thread.comments).nodes)
      ? (recordOf(thread.comments).nodes as unknown[])
      : [];
    const url = recordOf(first).url;
    return { id: thread.id, url: typeof url === 'string' ? url : null };
  },
});
