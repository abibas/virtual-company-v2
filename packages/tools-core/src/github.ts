import type {
  GitHubBranch,
  GitHubCheckRun,
  GitHubComment,
  GitHubCommit,
  GitHubContents,
  GitHubFile,
  GitHubIssue,
  GitHubIssueHit,
  GitHubPull,
  GitHubPullSummary,
  GitHubRepository,
  GitHubReview,
  GitHubReviewComment,
  GitHubStatus,
  SearchPage,
} from './github/results.ts';

/**
 * The GitHub port (S7.1d, docs/subscriptions.md "GitHub tools"): what the server asks of GitHub's REST API (and its
 * GraphQL for a pull request's draft state) for the agents' GitHub tools, with one opened sign-in per call, and what comes
 * back, trimmed to what an agent needs. The connector (`@mwc/github`) speaks `api.github.com`. Every method rejects with
 * `GitHubError` only. Nothing here merges, closes or deletes anything.
 */

/** A sign-in as the server opened it for one call: its token (`gh`'s device sign-in, or a pasted one). */
export interface GitHubSignIn {
  readonly token: string;
}

/** A repository by its owner and name. */
export interface RepoName {
  readonly owner: string;
  readonly repo: string;
}

export type {
  GitHubBranch,
  GitHubCheckRun,
  GitHubComment,
  GitHubCommit,
  GitHubContents,
  GitHubFile,
  GitHubIssue,
  GitHubIssueHit,
  GitHubPull,
  GitHubPullSummary,
  GitHubRepository,
  GitHubReview,
  GitHubReviewComment,
  GitHubStatus,
  SearchPage,
} from './github/results.ts';

/** Which page of a list: GitHub's `page` (from 1) and `per_page` (1 to 100). */
export interface Page {
  readonly page: number;
  readonly perPage: number;
}

/** A search: GitHub's query (`q`), its sort and order, and the page. */
export interface SearchQuery extends Page {
  readonly q: string;
  readonly sort?: string | undefined;
  readonly order?: 'asc' | 'desc' | undefined;
}

/** What a list of pull requests filters by. */
export interface PullFilter extends Page {
  readonly state?: 'open' | 'closed' | 'all' | undefined;
  readonly head?: string | undefined;
  readonly base?: string | undefined;
  readonly sort?: 'created' | 'updated' | 'popularity' | 'long-running' | undefined;
  readonly direction?: 'asc' | 'desc' | undefined;
}

/** What a list of commits filters by. */
export interface CommitFilter extends Page {
  readonly sha?: string | undefined;
  readonly author?: string | undefined;
  readonly path?: string | undefined;
  readonly since?: string | undefined;
  readonly until?: string | undefined;
}

export interface NewPullRequest {
  readonly title: string;
  readonly head: string;
  readonly base: string;
  readonly body?: string | undefined;
  readonly draft?: boolean | undefined;
  readonly maintainerCanModify?: boolean | undefined;
}

/** A pull request's change: its title, body and base only (its draft state is `setDraft`). */
export interface PullChange {
  readonly title?: string | undefined;
  readonly body?: string | undefined;
  readonly base?: string | undefined;
}

/** What the server asks of GitHub (see above). */
export interface GitHubApi {
  searchIssues(signIn: GitHubSignIn, query: SearchQuery): Promise<SearchPage<GitHubIssueHit>>;
  searchRepositories(signIn: GitHubSignIn, query: SearchQuery): Promise<SearchPage<GitHubRepository>>;
  listPullRequests(
    signIn: GitHubSignIn,
    repo: RepoName,
    filter: PullFilter,
  ): Promise<readonly GitHubPullSummary[]>;
  getPullRequest(signIn: GitHubSignIn, repo: RepoName, number: number): Promise<GitHubPull>;
  getPullRequestDiff(signIn: GitHubSignIn, repo: RepoName, number: number): Promise<string>;
  listPullRequestFiles(
    signIn: GitHubSignIn,
    repo: RepoName,
    number: number,
    page: Page,
  ): Promise<readonly GitHubFile[]>;
  listPullRequestCommits(
    signIn: GitHubSignIn,
    repo: RepoName,
    number: number,
    page: Page,
  ): Promise<readonly GitHubCommit[]>;
  listReviews(
    signIn: GitHubSignIn,
    repo: RepoName,
    number: number,
    page: Page,
  ): Promise<readonly GitHubReview[]>;
  listReviewComments(
    signIn: GitHubSignIn,
    repo: RepoName,
    number: number,
    page: Page,
  ): Promise<readonly GitHubReviewComment[]>;
  listIssueComments(
    signIn: GitHubSignIn,
    repo: RepoName,
    number: number,
    page: Page,
  ): Promise<readonly GitHubComment[]>;
  getCombinedStatus(signIn: GitHubSignIn, repo: RepoName, ref: string): Promise<GitHubStatus>;
  listCheckRuns(
    signIn: GitHubSignIn,
    repo: RepoName,
    ref: string,
    page: Page,
  ): Promise<readonly GitHubCheckRun[]>;
  getIssue(signIn: GitHubSignIn, repo: RepoName, number: number): Promise<GitHubIssue>;
  listSubIssues(
    signIn: GitHubSignIn,
    repo: RepoName,
    number: number,
    page: Page,
  ): Promise<readonly GitHubIssueHit[]>;
  listCommits(signIn: GitHubSignIn, repo: RepoName, filter: CommitFilter): Promise<readonly GitHubCommit[]>;
  getCommit(signIn: GitHubSignIn, repo: RepoName, ref: string, page: Page): Promise<GitHubCommit>;
  getContents(
    signIn: GitHubSignIn,
    repo: RepoName,
    where: { readonly path: string; readonly ref?: string | undefined },
  ): Promise<GitHubContents>;
  listBranches(signIn: GitHubSignIn, repo: RepoName, page: Page): Promise<readonly GitHubBranch[]>;
  createPullRequest(signIn: GitHubSignIn, repo: RepoName, pull: NewPullRequest): Promise<GitHubPull>;
  updatePullRequest(
    signIn: GitHubSignIn,
    repo: RepoName,
    number: number,
    change: PullChange,
  ): Promise<GitHubPull>;
  /** Marks a pull request (by its node id) a draft, or ready for review: GitHub's GraphQL, as REST cannot. */
  setDraft(signIn: GitHubSignIn, nodeId: string, draft: boolean): Promise<void>;
  addIssueComment(signIn: GitHubSignIn, repo: RepoName, number: number, body: string): Promise<GitHubComment>;
  requestReviewers(
    signIn: GitHubSignIn,
    repo: RepoName,
    number: number,
    reviewers: readonly string[],
  ): Promise<void>;
}
