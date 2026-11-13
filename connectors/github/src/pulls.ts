import { type GitHubApi, GitHubError, type Page, type RepoName } from '@mwc/tools-core';
import type { Request } from './http.ts';
import {
  checkRunOf,
  commitOf,
  fileOf,
  listOf,
  pullOf,
  pullSummaryOf,
  recordOf,
  reviewCommentOf,
  reviewOf,
  statusOf,
} from './map.ts';

/**
 * Pull requests through GitHub's REST API (S7.1d): a repository's list, one pull request, its diff, files, commits,
 * reviews and review comments, its head commit's status and check runs; and the changes: a new pull request, its
 * title, body and base, its draft state (GraphQL), and reviewers requested. Nothing here merges or closes one.
 */

type PullsApi = Pick<
  GitHubApi,
  | 'listPullRequests'
  | 'getPullRequest'
  | 'getPullRequestDiff'
  | 'listPullRequestFiles'
  | 'listPullRequestCommits'
  | 'listReviews'
  | 'listReviewComments'
  | 'getCombinedStatus'
  | 'listCheckRuns'
  | 'createPullRequest'
  | 'updatePullRequest'
  | 'setDraft'
  | 'requestReviewers'
>;

/** A repository's address, `rest` after it; each part encoded. */
export const repoPath = (repo: RepoName, rest = '') =>
  `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}${rest}`;

/** GitHub's page query. */
export const pageQuery = (page: Page) => ({ page: page.page, per_page: page.perPage });

const pullPath = (repo: RepoName, number: number, rest = '') => repoPath(repo, `/pulls/${number}${rest}`);
const refPath = (repo: RepoName, ref: string, rest: string) =>
  repoPath(repo, `/commits/${encodeURIComponent(ref)}${rest}`);

const DRAFT = `mutation($id: ID!) { convertPullRequestToDraft(input: {pullRequestId: $id}) { pullRequest { isDraft } } }`;
const READY = `mutation($id: ID!) { markPullRequestReadyForReview(input: {pullRequestId: $id}) { pullRequest { isDraft } } }`;

/** GraphQL's errors, which come with a 200, as a refusal in its words. */
function graphqlErrors(body: unknown): GitHubError | undefined {
  const errors = listOf(recordOf(body).errors);
  if (errors.length === 0) return undefined;
  const words = errors
    .map((error) => recordOf(error).message)
    .filter((message): message is string => typeof message === 'string');
  return new GitHubError('bad_request', { status: 200, detail: words.join('; ').slice(0, 500) || undefined });
}

/** Pull requests' reads. */
function pullReads(
  request: Request,
): Omit<PullsApi, 'createPullRequest' | 'updatePullRequest' | 'setDraft' | 'requestReviewers'> {
  const list = (signIn: Parameters<Request>[0], path: string, page: Page) =>
    request(signIn, { method: 'GET', path, query: pageQuery(page) }).then(listOf);
  return {
    async listPullRequests(signIn, repo, filter) {
      const { state, head, base, sort, direction } = filter;
      const query = { state, head, base, sort, direction, ...pageQuery(filter) };
      const raw = await request(signIn, { method: 'GET', path: repoPath(repo, '/pulls'), query });
      return listOf(raw).map(pullSummaryOf);
    },
    getPullRequest: async (signIn, repo, number) =>
      pullOf(await request(signIn, { method: 'GET', path: pullPath(repo, number) })),
    getPullRequestDiff: async (signIn, repo, number) =>
      String(await request(signIn, { method: 'GET', path: pullPath(repo, number), accept: 'diff' })),
    listPullRequestFiles: async (signIn, repo, number, page) =>
      (await list(signIn, pullPath(repo, number, '/files'), page)).map(fileOf),
    listPullRequestCommits: async (signIn, repo, number, page) =>
      (await list(signIn, pullPath(repo, number, '/commits'), page)).map(commitOf),
    listReviews: async (signIn, repo, number, page) =>
      (await list(signIn, pullPath(repo, number, '/reviews'), page)).map(reviewOf),
    listReviewComments: async (signIn, repo, number, page) =>
      (await list(signIn, pullPath(repo, number, '/comments'), page)).map(reviewCommentOf),
    getCombinedStatus: async (signIn, repo, ref) =>
      statusOf(await request(signIn, { method: 'GET', path: refPath(repo, ref, '/status') })),
    async listCheckRuns(signIn, repo, ref, page) {
      const path = refPath(repo, ref, '/check-runs');
      const raw = await request(signIn, { method: 'GET', path, query: pageQuery(page) });
      return listOf(recordOf(raw).check_runs).map(checkRunOf);
    },
  };
}

/** Pull requests' changes: never a merge, a close or a delete. */
function pullChanges(
  request: Request,
): Pick<PullsApi, 'createPullRequest' | 'updatePullRequest' | 'setDraft' | 'requestReviewers'> {
  return {
    async createPullRequest(signIn, repo, pull) {
      const body = {
        title: pull.title,
        head: pull.head,
        base: pull.base,
        ...(pull.body === undefined ? {} : { body: pull.body }),
        ...(pull.draft === undefined ? {} : { draft: pull.draft }),
        ...(pull.maintainerCanModify === undefined
          ? {}
          : { maintainer_can_modify: pull.maintainerCanModify }),
      };
      return pullOf(await request(signIn, { method: 'POST', path: repoPath(repo, '/pulls'), body }));
    },
    async updatePullRequest(signIn, repo, number, change) {
      const body = {
        ...(change.title === undefined ? {} : { title: change.title }),
        ...(change.body === undefined ? {} : { body: change.body }),
        ...(change.base === undefined ? {} : { base: change.base }),
      };
      return pullOf(await request(signIn, { method: 'PATCH', path: pullPath(repo, number), body }));
    },
    async setDraft(signIn, nodeId, draft) {
      const body = { query: draft ? DRAFT : READY, variables: { id: nodeId } };
      const error = graphqlErrors(await request(signIn, { method: 'POST', path: '/graphql', body }));
      if (error !== undefined) throw error;
    },
    async requestReviewers(signIn, repo, number, reviewers) {
      const path = pullPath(repo, number, '/requested_reviewers');
      await request(signIn, { method: 'POST', path, body: { reviewers: [...reviewers] } });
    },
  };
}

/** The pull requests' half of the port on `request`. */
export const pullsApi = (request: Request): PullsApi => ({ ...pullReads(request), ...pullChanges(request) });
