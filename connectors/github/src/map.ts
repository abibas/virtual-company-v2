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
} from '@mwc/tools-core';

/**
 * GitHub's REST answers as the port's shapes (S7.1d): the fields an agent reads, each one checked (a missing or odd
 * field is null, empty or zero, never a crash), people by their login, a repository by `owner/name`.
 */

type Raw = Readonly<Record<string, unknown>>;
export const recordOf = (value: unknown): Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Raw) : {};
export const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const text = (value: unknown): string => str(value) ?? '';
const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);
const login = (user: unknown): string | null => str(recordOf(user).login);
const logins = (users: unknown): string[] =>
  listOf(users)
    .map(login)
    .filter((name): name is string => name !== null);
const labelNames = (labels: unknown): string[] =>
  listOf(labels)
    .map((label) => (typeof label === 'string' ? label : str(recordOf(label).name)))
    .filter((name): name is string => name !== null);

/** `owner/name` from a repository's API address (`https://api.github.com/repos/owner/name`), or empty. */
export function repositoryOfUrl(url: unknown): string {
  const match = /\/repos\/([^/]+\/[^/]+)$/.exec(text(url));
  return match?.[1] ?? '';
}

export function pullSummaryOf(value: unknown): GitHubPullSummary {
  const raw = recordOf(value);
  const base = recordOf(raw.base);
  return {
    number: num(raw.number) ?? 0,
    title: text(raw.title),
    state: text(raw.state),
    draft: raw.draft === true,
    merged: raw.merged === true || typeof raw.merged_at === 'string',
    url: text(raw.html_url),
    repository: str(recordOf(base.repo).full_name) ?? '',
    author: login(raw.user),
    head: text(recordOf(raw.head).ref),
    base: text(base.ref),
    labels: labelNames(raw.labels),
    createdAt: str(raw.created_at),
    updatedAt: str(raw.updated_at),
  };
}

export function pullOf(value: unknown): GitHubPull {
  const raw = recordOf(value);
  const head = recordOf(raw.head);
  return {
    ...pullSummaryOf(raw),
    nodeId: text(raw.node_id),
    body: str(raw.body),
    headSha: text(head.sha),
    headRepository: str(recordOf(head.repo).full_name),
    mergeable: typeof raw.mergeable === 'boolean' ? raw.mergeable : null,
    mergeableState: str(raw.mergeable_state),
    comments: num(raw.comments),
    reviewComments: num(raw.review_comments),
    commits: num(raw.commits),
    additions: num(raw.additions),
    deletions: num(raw.deletions),
    changedFiles: num(raw.changed_files),
    requestedReviewers: logins(raw.requested_reviewers),
    mergedAt: str(raw.merged_at),
    closedAt: str(raw.closed_at),
  };
}

export function issueHitOf(value: unknown): GitHubIssueHit {
  const raw = recordOf(value);
  return {
    number: num(raw.number) ?? 0,
    title: text(raw.title),
    state: text(raw.state),
    isPullRequest: raw.pull_request !== undefined && raw.pull_request !== null,
    url: text(raw.html_url),
    repository: repositoryOfUrl(raw.repository_url),
    author: login(raw.user),
    labels: labelNames(raw.labels),
    comments: num(raw.comments),
    createdAt: str(raw.created_at),
    updatedAt: str(raw.updated_at),
    closedAt: str(raw.closed_at),
    body: str(raw.body),
  };
}

export function issueOf(value: unknown): GitHubIssue {
  const raw = recordOf(value);
  return {
    ...issueHitOf(raw),
    assignees: logins(raw.assignees),
    milestone: str(recordOf(raw.milestone).title),
    stateReason: str(raw.state_reason),
  };
}

export function commentOf(value: unknown): GitHubComment {
  const raw = recordOf(value);
  return {
    id: num(raw.id) ?? 0,
    author: login(raw.user),
    body: text(raw.body),
    createdAt: str(raw.created_at),
    url: str(raw.html_url),
  };
}

export function reviewOf(value: unknown): GitHubReview {
  const raw = recordOf(value);
  return {
    id: num(raw.id) ?? 0,
    author: login(raw.user),
    state: text(raw.state),
    body: text(raw.body),
    submittedAt: str(raw.submitted_at),
    url: str(raw.html_url),
  };
}

export function reviewCommentOf(value: unknown): GitHubReviewComment {
  const raw = recordOf(value);
  return {
    ...commentOf(raw),
    path: str(raw.path),
    line: num(raw.line) ?? num(raw.original_line),
    inReplyTo: num(raw.in_reply_to_id),
  };
}

export function fileOf(value: unknown): GitHubFile {
  const raw = recordOf(value);
  return {
    filename: text(raw.filename),
    status: text(raw.status),
    additions: num(raw.additions) ?? 0,
    deletions: num(raw.deletions) ?? 0,
    patch: str(raw.patch),
    previousFilename: str(raw.previous_filename),
  };
}

export function commitOf(value: unknown): GitHubCommit {
  const raw = recordOf(value);
  const commit = recordOf(raw.commit);
  const author = recordOf(commit.author);
  return {
    sha: text(raw.sha),
    message: text(commit.message),
    author: login(raw.author) ?? str(author.name),
    date: str(author.date),
    url: str(raw.html_url),
    files: listOf(raw.files).map(fileOf),
  };
}

export function branchOf(value: unknown): GitHubBranch {
  const raw = recordOf(value);
  return { name: text(raw.name), sha: text(recordOf(raw.commit).sha), protected: raw.protected === true };
}

export function repositoryOf(value: unknown): GitHubRepository {
  const raw = recordOf(value);
  return {
    fullName: text(raw.full_name),
    description: str(raw.description),
    private: raw.private === true,
    archived: raw.archived === true,
    defaultBranch: str(raw.default_branch),
    url: text(raw.html_url),
    language: str(raw.language),
    updatedAt: str(raw.pushed_at) ?? str(raw.updated_at),
  };
}

export function statusOf(value: unknown): GitHubStatus {
  const raw = recordOf(value);
  return {
    state: text(raw.state),
    statuses: listOf(raw.statuses).map((item) => {
      const status = recordOf(item);
      return {
        context: text(status.context),
        state: text(status.state),
        description: str(status.description),
        url: str(status.target_url),
      };
    }),
  };
}

export function checkRunOf(value: unknown): GitHubCheckRun {
  const raw = recordOf(value);
  return {
    name: text(raw.name),
    status: text(raw.status),
    conclusion: str(raw.conclusion),
    url: str(raw.html_url),
    completedAt: str(raw.completed_at),
  };
}

/** A file's base64 content as text; null when it is not there (over 1 MB) or not text (a NUL byte, or not UTF-8). */
export function textOf(content: unknown, encoding: unknown): string | null {
  if (encoding !== 'base64' || typeof content !== 'string') return null;
  const bytes = Buffer.from(content, 'base64');
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** A path's contents: a folder's entries (GitHub gives a list) or a file (anything else: a link or submodule has no text). */
export function contentsOf(value: unknown, path: string): GitHubContents {
  if (Array.isArray(value)) {
    const entries = value.map((item) => {
      const entry = recordOf(item);
      return { name: text(entry.name), type: text(entry.type), size: num(entry.size) ?? 0 };
    });
    return { kind: 'dir', path, entries };
  }
  const raw = recordOf(value);
  return {
    kind: 'file',
    path: str(raw.path) ?? path,
    sha: text(raw.sha),
    size: num(raw.size) ?? 0,
    text: raw.type === 'file' ? textOf(raw.content, raw.encoding) : null,
  };
}
