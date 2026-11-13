import { z } from 'zod';

/**
 * The GitHub tools' names and inputs (S7.1d, docs/subscriptions.md "GitHub tools"): GitHub's MCP server's, as its README
 * listed them on 2026-11-13 (reads of a pull request or an issue are one tool each with a `method`), so an agent's habits
 * carry over. Other arguments of that server's that change nothing here (`fields`, `after`, `minimal_output`) are taken
 * and ignored; what would do something not offered (closing a pull request with `state`, requesting reviewers, a
 * reaction) is refused by name (`REFUSED_ARGUMENTS`). Nothing merges, closes or deletes. The server checks every call's
 * input with these schemas; the runner only relays them.
 */

export const GITHUB_READ_TOOLS = [
  'search_pull_requests',
  'list_pull_requests',
  'pull_request_read',
  'search_issues',
  'issue_read',
  'list_commits',
  'get_commit',
  'get_file_contents',
  'list_branches',
  'search_repositories',
] as const;
export const GITHUB_PR_TOOLS = [
  'create_pull_request',
  'update_pull_request',
  'add_issue_comment',
  'request_copilot_review',
] as const;

export const GitHubTool = z.enum([...GITHUB_READ_TOOLS, ...GITHUB_PR_TOOLS]);
export type GitHubTool = z.infer<typeof GitHubTool>;

/** What `pull_request_read` reads. */
export const PULL_METHODS = [
  'get',
  'get_diff',
  'get_status',
  'get_files',
  'get_commits',
  'get_review_comments',
  'get_reviews',
  'get_comments',
  'get_check_runs',
] as const;

/** What `issue_read` reads. */
export const ISSUE_METHODS = ['get', 'get_comments', 'get_sub_issues', 'get_labels'] as const;

/** The longest body a tool writes (a pull request's, a comment): what the runner's socket carries. */
export const BODY_MAX = 50_000;

/** A repository owner, as GitHub allows one: letters, digits and dashes, up to 39. */
export const OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
/** A repository name: letters, digits, `.`, `_` and `-`, up to 100, not `.` or `..`. */
export const REPO_PATTERN = /^(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/;

const owner = z.string().trim().regex(OWNER_PATTERN, 'a GitHub owner').describe('Repository owner');
const repo = z.string().trim().regex(REPO_PATTERN, 'a repository name').describe('Repository name');
const number = (what: string) => z.int().min(1).max(2_147_483_647).describe(what);
const page = z.int().min(1).max(1000).optional().describe('Page number for pagination (min 1)');
const perPage = z
  .int()
  .min(1)
  .max(100)
  .optional()
  .describe('Results per page for pagination (min 1, max 100)');
const order = z.enum(['asc', 'desc']).optional().describe('Sort order');
const ref = (what: string) => z.string().trim().min(1).max(255).describe(what);
const ignored = (what: string) => z.unknown().optional().describe(`${what}: accepted and ignored`);
const search = (what: string) => ({
  query: z.string().trim().min(1).max(1000).describe(`Search query using GitHub ${what} search syntax`),
  owner: owner.optional().describe('Optional repository owner; with repo, only that repository'),
  repo: repo.optional().describe('Optional repository name (with owner)'),
  sort: z.string().trim().max(50).optional().describe('Sort field, defaults to best match'),
  order,
  page,
  perPage,
  fields: ignored('fields'),
});
const pull = { owner, repo, pullNumber: number('Pull request number') };

/** Each tool's input. */
export const GITHUB_INPUTS = {
  search_pull_requests: z.object(search('pull request')),
  list_pull_requests: z.object({
    owner,
    repo,
    state: z.enum(['open', 'closed', 'all']).optional().describe('Filter by state (open by default)'),
    head: z
      .string()
      .trim()
      .max(300)
      .optional()
      .describe('Filter by head user/org and branch (user:ref-name)'),
    base: z.string().trim().max(255).optional().describe('Filter by base branch'),
    sort: z.enum(['created', 'updated', 'popularity', 'long-running']).optional().describe('Sort by'),
    direction: order.describe('Sort direction'),
    page,
    perPage,
    fields: ignored('fields'),
  }),
  pull_request_read: z.object({
    method: z.enum(PULL_METHODS).describe(`What to read: ${PULL_METHODS.join(', ')}`),
    ...pull,
    page,
    perPage,
    after: ignored('after'),
  }),
  search_issues: z.object(search('issues')),
  issue_read: z.object({
    method: z.enum(ISSUE_METHODS).describe(`What to read: ${ISSUE_METHODS.join(', ')}`),
    owner,
    repo,
    issue_number: number('The issue number'),
    page,
    perPage,
  }),
  list_commits: z.object({
    owner,
    repo,
    sha: ref(
      'Commit SHA, branch or tag name to list commits of (the default branch if not given)',
    ).optional(),
    author: z.string().trim().max(255).optional().describe('Author username or email address'),
    path: z.string().max(1000).optional().describe('Only commits containing this file path'),
    since: z.string().max(40).optional().describe('Only commits after this date (ISO 8601)'),
    until: z.string().max(40).optional().describe('Only commits before this date (ISO 8601)'),
    page,
    perPage,
    fields: ignored('fields'),
  }),
  get_commit: z.object({
    owner,
    repo,
    sha: ref('Commit SHA, branch name, or tag name'),
    detail: z.string().max(20).optional().describe('"none" leaves out the changed files'),
    page,
    perPage,
  }),
  get_file_contents: z.object({
    owner,
    repo,
    path: z.string().max(1000).optional().describe('Path to file/directory (the root by default)'),
    ref: ref('Git ref: a branch, a tag, refs/heads/…, refs/pull/{n}/head').optional(),
    sha: ref('Commit SHA; used instead of ref').optional(),
    fields: ignored('fields'),
  }),
  list_branches: z.object({ owner, repo, page, perPage }),
  search_repositories: z.object({
    query: z.string().trim().min(1).max(1000).describe('Repository search query'),
    sort: z.string().trim().max(50).optional().describe('Sort repositories by field, defaults to best match'),
    order,
    page,
    perPage,
    minimal_output: ignored('minimal_output'),
  }),
  create_pull_request: z.object({
    owner,
    repo,
    title: z.string().trim().min(1).max(256).describe('PR title'),
    head: ref('Branch containing changes'),
    base: ref('Branch to merge into'),
    body: z.string().max(BODY_MAX).optional().describe('PR description'),
    draft: z.boolean().optional().describe('Create as draft PR'),
    maintainer_can_modify: z.boolean().optional().describe('Allow maintainer edits'),
  }),
  update_pull_request: z
    .object({
      ...pull,
      title: z.string().trim().min(1).max(256).optional().describe('New title'),
      body: z.string().max(BODY_MAX).optional().describe('New description'),
      base: ref('New base branch name').optional(),
      draft: z.boolean().optional().describe('Mark pull request as draft (true) or ready for review (false)'),
    })
    .refine(
      (input) => [input.title, input.body, input.base, input.draft].some((field) => field !== undefined),
      'give at least one of title, body, base and draft',
    ),
  add_issue_comment: z.object({
    owner,
    repo,
    issue_number: number('Pull request number to comment on'),
    body: z.string().trim().min(1).max(BODY_MAX).describe('Comment content'),
  }),
  request_copilot_review: z.object(pull),
} satisfies Record<GitHubTool, z.ZodType>;

export type GitHubInput<T extends GitHubTool> = z.output<(typeof GITHUB_INPUTS)[T]>;

const REVIEWERS =
  'Requesting reviewers is not offered here; request_copilot_review asks Copilot, the rest is the person’s.';

/** Arguments of GitHub's MCP server that would do something not offered here, refused by name. */
export const REFUSED_ARGUMENTS: Partial<Record<GitHubTool, Readonly<Record<string, string>>>> = {
  create_pull_request: { reviewers: REVIEWERS },
  update_pull_request: {
    state: 'Closing or reopening a pull request is not offered: nothing here closes one.',
    reviewers: REVIEWERS,
    maintainer_can_modify: 'update_pull_request changes the title, body, base and draft state only.',
  },
  add_issue_comment: {
    comment_id: 'Reactions are not offered: write a comment with body.',
    reaction: 'Reactions are not offered: write a comment with body.',
  },
};
