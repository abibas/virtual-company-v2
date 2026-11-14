import type { GitHubRights } from '@mwc/shared/credentials';
import type { ServerToolDef } from '@mwc/shared/harness';
import { z } from 'zod';
import {
  GITHUB_INPUTS,
  type GitHubTool,
  ISSUE_METHODS,
  PULL_METHODS,
  REVIEW_METHODS,
} from '../../schemas/github.ts';
import { changesGitHub } from './rights.ts';

/**
 * The GitHub tools' words (S7.1d): what each one is for, as its `tools/list` entry says it, its definition for a turn's
 * spec (its input schema from its zod input), the line a turn's standing instructions get (what the agent may do, where,
 * as whom, with which tools, and what git and gh on the machine get in this turn), and their label.
 */

const info = (title: string, description: string) => ({ title, description });

/** What each tool is for. */
export const GITHUB_TOOL_INFO: Readonly<Record<GitHubTool, { title: string; description: string }>> = {
  search_pull_requests: info(
    'Search pull requests',
    'Search pull requests with GitHub’s search syntax (is:pr is added), within the repositories your profile ' +
      'reaches; owner and repo narrow it to one.',
  ),
  list_pull_requests: info(
    'List pull requests',
    'A repository’s pull requests, by state, head, base and sort.',
  ),
  pull_request_read: info(
    'Read a pull request',
    `One pull request by its number: method ${PULL_METHODS.join(', ')}.`,
  ),
  search_issues: info(
    'Search issues',
    'Search issues with GitHub’s search syntax (is:issue is added), within the repositories your profile reaches.',
  ),
  issue_read: info('Read an issue', `One issue by its number: method ${ISSUE_METHODS.join(', ')}.`),
  list_commits: info(
    'List commits',
    'A branch’s or tag’s commits (the default branch’s if none), newest first.',
  ),
  get_commit: info(
    'Read a commit',
    'One commit by its SHA, branch or tag, with its changed files and patches.',
  ),
  get_file_contents: info(
    'Read a file or folder',
    'A file’s text, or a folder’s entries, at a ref or commit (the default branch’s if none).',
  ),
  list_branches: info('List branches', 'A repository’s branches, with their head commits.'),
  search_repositories: info(
    'Search repositories',
    'Search repositories with GitHub’s search syntax, within the ones your profile reaches.',
  ),
  create_pull_request: info(
    'Open a pull request',
    'Opens a pull request from a pushed branch (head) into base, optionally as a draft. Never merges.',
  ),
  update_pull_request: info(
    'Update a pull request',
    'Changes a pull request’s title, body or base, or makes it a draft or ready for review. Never merges or closes.',
  ),
  add_issue_comment: info('Comment on a pull request', 'Adds a comment to a pull request’s conversation.'),
  request_copilot_review: info(
    'Ask Copilot to review',
    'Requests a review of a pull request from GitHub Copilot.',
  ),
  pull_request_review_write: info(
    'Review a pull request',
    `Reviews a pull request: method ${REVIEW_METHODS.join(', ')}. create with an event (APPROVE, REQUEST_CHANGES, ` +
      'COMMENT) submits the review, with optional line comments; without one it stays pending. submit_pending ' +
      'submits your pending review with an event; delete_pending deletes it. Never merges, closes or dismisses ' +
      'reviews, and never approves your own pull request.',
  ),
  add_comment_to_pending_review: info(
    'Comment in a pending review',
    'Adds a comment on a file or a line (or range) of the diff to your pending review of a pull request; ' +
      'submit it with pull_request_review_write method submit_pending.',
  ),
};

/** A tool's input schema as `tools/list` gives it: its JSON Schema without the `$schema` line. */
function inputSchema(tool: GitHubTool): Record<string, unknown> {
  const { $schema: _, ...schema } = z.toJSONSchema(GITHUB_INPUTS[tool], {
    io: 'input',
    unrepresentable: 'any',
  });
  return schema;
}

const DEFS = new Map<GitHubTool, ServerToolDef>();

/** A tool as a turn's spec carries it (made once). */
export function githubToolDef(tool: GitHubTool): ServerToolDef {
  const made = DEFS.get(tool) ?? {
    name: tool,
    ...GITHUB_TOOL_INFO[tool],
    inputSchema: inputSchema(tool),
    readOnly: !changesGitHub(tool),
  };
  DEFS.set(tool, made);
  return made;
}

/**
 * What git and gh on the machine get in this turn: the sign-in (`token`), nothing since the part may not push (`off`) or
 * its runner is too old to take it (`runner`), or the sign-in could not be opened (its words).
 */
export type GitState =
  | { readonly kind: 'token' | 'off' | 'runner' }
  | { readonly kind: 'failed'; readonly message: string };

const GIT_WORDS = {
  token:
    'git and gh on this machine use this sign-in in this turn (GH_TOKEN; git@github.com remotes go over https): push ' +
    'your branches to those repositories, never to a default branch and never with force; the tools above are ' +
    'preferred for reading and for pull requests.',
  off: 'Pushing is off for this profile: git and gh on this machine get no GitHub sign-in from Most Wanted.',
  runner:
    "Pushing: this machine's runner is too old to give git and gh this sign-in; tell the person to update the runner " +
    'on the Machines page.',
} as const;

const gitWords = (git: GitState) =>
  git.kind === 'failed'
    ? `Pushing: the sign-in could not be opened for git now. ${git.message}`
    : GIT_WORDS[git.kind];

const REVIEWS_MAY = {
  comment: 'review them with comments',
  approve: 'review them (comment, approve or request changes)',
} as const;

/** What the rights let the agent do: "read, and open and update pull requests", and its reviews. */
function mayWords(rights: GitHubRights): string {
  const pulls = rights.pullRequests ? 'open and update pull requests' : '';
  if (rights.reviews === 'off') return pulls === '' ? 'read' : `read, and ${pulls}`;
  const reviews = REVIEWS_MAY[rights.reviews];
  return pulls === ''
    ? `read, and ${reviews.replace('them', 'pull requests')}`
    : `read, ${pulls}, and ${reviews}`;
}

/** What the tools never do. */
const neverWords = (rights: GitHubRights) =>
  rights.reviews === 'off'
    ? 'they never merge, close or delete.'
    : "they never merge, close, delete, dismiss others' reviews or approve your own pull requests.";

/**
 * The line a turn's standing instructions get with the tools: "GitHub tools (from Most Wanted): as ihorherasko, in
 * AiriaLLC/*: read, and open and update pull requests. Your tools, by the names of GitHub's MCP server: …; they never
 * merge, close or delete." and what git and gh get.
 */
export function githubLine(
  account: string | null,
  rights: GitHubRights,
  tools: readonly GitHubTool[],
  git: GitState,
): string {
  const as = account === null ? '' : ` as ${account.replace(/\s+/g, ' ').trim()},`;
  const where =
    rights.repos === 'all' ? 'in every repository the account can see' : `in ${rights.repos.join(', ')}`;
  return (
    `GitHub tools (from Most Wanted):${as} ${where}: ${mayWords(rights)}. Your tools, by the names of GitHub's MCP ` +
    `server: ${tools.join(', ')}; owner and repo name the repository; ${neverWords(rights)} ${gitWords(git)}`
  );
}

/** What the tools are for, in a word, for a turn on a runner too old for them and the chat's notice. */
export const GITHUB_LABEL = 'GitHub';

/** What a profile that may push waits for when its runner is too old to give git the sign-in. */
export const GITHUB_PUSH_LABEL = 'git push';
