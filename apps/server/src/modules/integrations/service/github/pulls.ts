import {
  commentView,
  commitView,
  diffView,
  fileView,
  pullSummaryView,
  pullView,
} from '../../rules/github/render.ts';
import type { GitHubInput } from '../../schemas/github.ts';
import { done, excerpt, refused, type ToolReply } from '../reply.ts';
import { type GitHubContext, pageOf, pullId, repoOf } from './context.ts';

/**
 * The pull request tools (S7.1d): a repository's list and one pull request read by `method`; and, with the
 * `pullRequests` right, opening one, changing its title, body, base or draft state, commenting on it and asking Copilot
 * to review it. Each change is audited as the agent on `owner/repo#n`. Nothing merges or closes a pull request. The
 * repository was checked against the allowlist before any of these runs (`call.ts`).
 */

/** Copilot's reviewer, as GitHub's MCP server requests it. */
export const COPILOT_REVIEWER = 'copilot-pull-request-reviewer[bot]';

async function listPulls(ctx: GitHubContext, input: GitHubInput<'list_pull_requests'>) {
  const { state, head, base, sort, direction } = input;
  const filter = { state, head, base, sort, direction, ...pageOf(input) };
  const pulls = await ctx.api.listPullRequests(ctx.signIn, repoOf(input), filter);
  return done(pulls.map(pullSummaryView));
}

/** `pull_request_read`: one pull request's facts, diff, status, files, commits, reviews, comments or check runs. */
async function readPull(ctx: GitHubContext, input: GitHubInput<'pull_request_read'>): Promise<ToolReply> {
  const { api, signIn } = ctx;
  const repo = repoOf(input);
  const number = input.pullNumber;
  const page = pageOf(input);
  switch (input.method) {
    case 'get':
      return done(pullView(await api.getPullRequest(signIn, repo, number)));
    case 'get_diff':
      return done(diffView(await api.getPullRequestDiff(signIn, repo, number)));
    case 'get_files':
      return done((await api.listPullRequestFiles(signIn, repo, number, page)).map(fileView));
    case 'get_commits':
      return done((await api.listPullRequestCommits(signIn, repo, number, page)).map(commitView));
    case 'get_reviews':
      return done((await api.listReviews(signIn, repo, number, page)).map(commentView));
    case 'get_review_comments':
      return done((await api.listReviewComments(signIn, repo, number, page)).map(commentView));
    case 'get_comments':
      return done((await api.listIssueComments(signIn, repo, number, page)).map(commentView));
    case 'get_status': {
      const { headSha } = await api.getPullRequest(signIn, repo, number);
      return done({ headSha, ...(await api.getCombinedStatus(signIn, repo, headSha)) });
    }
    case 'get_check_runs': {
      const { headSha } = await api.getPullRequest(signIn, repo, number);
      return done({ headSha, checkRuns: await api.listCheckRuns(signIn, repo, headSha, page) });
    }
  }
}

async function createPull(ctx: GitHubContext, input: GitHubInput<'create_pull_request'>) {
  const repo = repoOf(input);
  const { title, head, base, body, draft } = input;
  const pull = await ctx.api.createPullRequest(ctx.signIn, repo, {
    title,
    head,
    base,
    body,
    draft,
    maintainerCanModify: input.maintainer_can_modify,
  });
  await ctx.audit({
    entityId: pullId(repo, pull.number),
    changes: [
      { field: 'title', new: title },
      { field: 'head', new: head },
      { field: 'base', new: base },
      ...(draft ? [{ field: 'draft', new: true }] : []),
      ...(body === undefined ? [] : [{ field: 'body', new: excerpt(body) }]),
    ],
  });
  return done(pullView(pull));
}

/** Changes its title, body and base (REST) and its draft state (GraphQL, only when it differs), audited with what was. */
async function updatePull(ctx: GitHubContext, input: GitHubInput<'update_pull_request'>) {
  const { api, signIn } = ctx;
  const repo = repoOf(input);
  const before = await api.getPullRequest(signIn, repo, input.pullNumber);
  const { title, body, base, draft } = input;
  const fields = [title, body, base].some((field) => field !== undefined);
  let after = fields
    ? await api.updatePullRequest(signIn, repo, input.pullNumber, { title, body, base })
    : before;
  const redraft = draft !== undefined && draft !== before.draft;
  if (redraft) {
    await api.setDraft(signIn, before.nodeId, draft);
    after = { ...after, draft };
  }
  const changes = [
    ...(title === undefined ? [] : [{ field: 'title', old: before.title, new: title }]),
    ...(base === undefined ? [] : [{ field: 'base', old: before.base, new: base }]),
    ...(body === undefined ? [] : [{ field: 'body', old: excerpt(before.body ?? ''), new: excerpt(body) }]),
    ...(redraft ? [{ field: 'draft', old: before.draft, new: draft }] : []),
  ];
  if (changes.length > 0) await ctx.audit({ entityId: pullId(repo, before.number), changes });
  return done(pullView(after));
}

/** A comment on a pull request's conversation; an issue that is not a pull request is refused. */
async function commentOnPull(ctx: GitHubContext, input: GitHubInput<'add_issue_comment'>) {
  const repo = repoOf(input);
  const issue = await ctx.api.getIssue(ctx.signIn, repo, input.issue_number);
  if (!issue.isPullRequest)
    return refused(
      `${pullId(repo, input.issue_number)} is an issue, not a pull request: comments go on pull requests only.`,
    );
  const comment = await ctx.api.addIssueComment(ctx.signIn, repo, input.issue_number, input.body);
  const changes = [{ field: 'comment', new: `${comment.id}: ${excerpt(input.body)}` }];
  await ctx.audit({ entityId: pullId(repo, input.issue_number), changes });
  return done(commentView(comment));
}

async function copilotReview(ctx: GitHubContext, input: GitHubInput<'request_copilot_review'>) {
  const repo = repoOf(input);
  await ctx.api.requestReviewers(ctx.signIn, repo, input.pullNumber, [COPILOT_REVIEWER]);
  const id = pullId(repo, input.pullNumber);
  await ctx.audit({ entityId: id, changes: [{ field: 'reviewer', new: COPILOT_REVIEWER }] });
  return done({ requested: 'Copilot', pullRequest: id });
}

export const PULL_TOOLS = {
  list_pull_requests: listPulls,
  pull_request_read: readPull,
  create_pull_request: createPull,
  update_pull_request: updatePull,
  add_issue_comment: commentOnPull,
  request_copilot_review: copilotReview,
};
