import type { GitHubApi, RepoName, SearchQuery } from '@mwc/tools-core';
import type { Request } from './http.ts';
import {
  branchOf,
  commentOf,
  commitOf,
  contentsOf,
  issueHitOf,
  issueOf,
  listOf,
  recordOf,
  repositoryOf,
} from './map.ts';
import { pageQuery, repoPath } from './pulls.ts';

/**
 * Searches, issues and repositories through GitHub's REST API (S7.1d): the issues and pull requests search, the
 * repositories search, an issue with its comments and sub-issues, a comment added, commits, one commit, a path's
 * contents and the branches. Nothing here deletes anything.
 */

type ReposApi = Pick<
  GitHubApi,
  | 'searchIssues'
  | 'searchRepositories'
  | 'getIssue'
  | 'listIssueComments'
  | 'listSubIssues'
  | 'addIssueComment'
  | 'listCommits'
  | 'getCommit'
  | 'getContents'
  | 'listBranches'
>;

const issuePath = (repo: RepoName, number: number, rest = '') => repoPath(repo, `/issues/${number}${rest}`);

/** A path in a repository, each segment encoded (its slashes kept). */
export const contentsPath = (repo: RepoName, path: string) => {
  const segments = path.split('/').filter((segment) => segment !== '');
  return repoPath(repo, `/contents/${segments.map(encodeURIComponent).join('/')}`);
};

/** A search's query and page as GitHub takes them. */
const searchParams = (query: SearchQuery) => ({
  q: query.q,
  sort: query.sort,
  order: query.order,
  ...pageQuery(query),
});

/** A search answer's total, whether it is complete, and its items mapped. */
function searchPage<T>(raw: unknown, map: (item: unknown) => T) {
  const body = recordOf(raw);
  return {
    total: typeof body.total_count === 'number' ? body.total_count : 0,
    incomplete: body.incomplete_results === true,
    items: listOf(body.items).map(map),
  };
}

/** The searches', issues' and repositories' half of the port on `request`. */
export function reposApi(request: Request): ReposApi {
  const get = (signIn: Parameters<Request>[0], path: string, query = {}) =>
    request(signIn, { method: 'GET', path, query });
  return {
    searchIssues: async (signIn, query) =>
      searchPage(await get(signIn, '/search/issues', searchParams(query)), issueHitOf),
    searchRepositories: async (signIn, query) =>
      searchPage(await get(signIn, '/search/repositories', searchParams(query)), repositoryOf),
    getIssue: async (signIn, repo, number) => issueOf(await get(signIn, issuePath(repo, number))),
    listIssueComments: async (signIn, repo, number, page) =>
      listOf(await get(signIn, issuePath(repo, number, '/comments'), pageQuery(page))).map(commentOf),
    listSubIssues: async (signIn, repo, number, page) =>
      listOf(await get(signIn, issuePath(repo, number, '/sub_issues'), pageQuery(page))).map(issueHitOf),
    async addIssueComment(signIn, repo, number, body) {
      const path = issuePath(repo, number, '/comments');
      return commentOf(await request(signIn, { method: 'POST', path, body: { body } }));
    },
    async listCommits(signIn, repo, filter) {
      const { sha, author, path, since, until } = filter;
      const query = { sha, author, path, since, until, ...pageQuery(filter) };
      return listOf(await get(signIn, repoPath(repo, '/commits'), query)).map(commitOf);
    },
    getCommit: async (signIn, repo, ref, page) =>
      commitOf(await get(signIn, repoPath(repo, `/commits/${encodeURIComponent(ref)}`), pageQuery(page))),
    getContents: async (signIn, repo, where) =>
      contentsOf(await get(signIn, contentsPath(repo, where.path), { ref: where.ref }), where.path),
    listBranches: async (signIn, repo, page) =>
      listOf(await get(signIn, repoPath(repo, '/branches'), pageQuery(page))).map(branchOf),
  };
}
