import { scopedSearch } from '../../rules/github/query.ts';
import { commentView, commitView, contentsView, issueView } from '../../rules/github/render.ts';
import { fullNameInScope } from '../../rules/github/rights.ts';
import type { GitHubInput } from '../../schemas/github.ts';
import { done, refused, type ToolReply } from '../reply.ts';
import { type GitHubContext, pageOf, repoOf } from './context.ts';

/**
 * The GitHub read tools besides pull requests' own (S7.1d): searches kept to the profile's repositories (their query
 * scoped by `query.ts`, and every result outside the allowlist dropped), an issue read by `method`, commits, one commit,
 * a file or folder, and the branches. The repository a tool names was checked before any of these runs (`call.ts`).
 */

/** A search of issues or pull requests (see above). */
async function searchIssues(
  ctx: GitHubContext,
  input: GitHubInput<'search_pull_requests'>,
  kind: 'pr' | 'issue',
): Promise<ToolReply> {
  const scoped = scopedSearch(input, kind, ctx.rights.repos);
  if (!scoped.ok) return refused(scoped.error);
  const { sort, order } = input;
  const page = await ctx.api.searchIssues(ctx.signIn, { q: scoped.q, sort, order, ...pageOf(input) });
  const items = page.items.filter((item) => fullNameInScope(ctx.rights.repos, item.repository));
  return done({
    query: scoped.q,
    total: page.total,
    ...(page.incomplete ? { incomplete: true } : {}),
    items: items.map((item) => issueView(item)),
  });
}

/** `issue_read`: one issue's facts, comments, sub-issues or labels. */
async function readIssue(ctx: GitHubContext, input: GitHubInput<'issue_read'>): Promise<ToolReply> {
  const { api, signIn } = ctx;
  const repo = repoOf(input);
  const number = input.issue_number;
  switch (input.method) {
    case 'get':
      return done(issueView(await api.getIssue(signIn, repo, number), true));
    case 'get_comments':
      return done((await api.listIssueComments(signIn, repo, number, pageOf(input))).map(commentView));
    case 'get_sub_issues':
      return done(
        (await api.listSubIssues(signIn, repo, number, pageOf(input))).map((item) => issueView(item)),
      );
    case 'get_labels':
      return done({ labels: (await api.getIssue(signIn, repo, number)).labels });
  }
}

async function listCommits(ctx: GitHubContext, input: GitHubInput<'list_commits'>) {
  const { sha, author, path, since, until } = input;
  const filter = { sha, author, path, since, until, ...pageOf(input) };
  return done((await ctx.api.listCommits(ctx.signIn, repoOf(input), filter)).map(commitView));
}

async function getCommit(ctx: GitHubContext, input: GitHubInput<'get_commit'>) {
  const commit = await ctx.api.getCommit(ctx.signIn, repoOf(input), input.sha, pageOf(input));
  return done(commitView(input.detail === 'none' ? { ...commit, files: [] } : commit));
}

async function fileContents(ctx: GitHubContext, input: GitHubInput<'get_file_contents'>) {
  const where = { path: input.path ?? '', ref: input.sha ?? input.ref };
  return done(contentsView(await ctx.api.getContents(ctx.signIn, repoOf(input), where)));
}

async function listBranches(ctx: GitHubContext, input: GitHubInput<'list_branches'>) {
  return done(await ctx.api.listBranches(ctx.signIn, repoOf(input), pageOf(input)));
}

async function searchRepositories(ctx: GitHubContext, input: GitHubInput<'search_repositories'>) {
  const scoped = scopedSearch(input, 'repository', ctx.rights.repos);
  if (!scoped.ok) return refused(scoped.error);
  const { sort, order } = input;
  const page = await ctx.api.searchRepositories(ctx.signIn, { q: scoped.q, sort, order, ...pageOf(input) });
  const items = page.items.filter((item) => fullNameInScope(ctx.rights.repos, item.fullName));
  return done({ query: scoped.q, total: page.total, items });
}

export const REPO_TOOLS = {
  search_pull_requests: (ctx: GitHubContext, input: GitHubInput<'search_pull_requests'>) =>
    searchIssues(ctx, input, 'pr'),
  search_issues: (ctx: GitHubContext, input: GitHubInput<'search_issues'>) =>
    searchIssues(ctx, input, 'issue'),
  issue_read: readIssue,
  list_commits: listCommits,
  get_commit: getCommit,
  get_file_contents: fileContents,
  list_branches: listBranches,
  search_repositories: searchRepositories,
};
