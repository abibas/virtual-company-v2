/**
 * What the GitHub port (`../github.ts`, S7.1d) gives back: pull requests, issues, comments, reviews, files, commits,
 * branches, repositories, statuses, check runs and contents, each trimmed to what an agent needs.
 */

/** A pull request as a list shows it. */
export interface GitHubPullSummary {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly draft: boolean;
  readonly merged: boolean;
  readonly url: string;
  readonly repository: string;
  readonly author: string | null;
  readonly head: string;
  readonly base: string;
  readonly labels: readonly string[];
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

/** One pull request whole: what a list shows, and its body, head commit, counts and reviewers. */
export interface GitHubPull extends GitHubPullSummary {
  readonly nodeId: string;
  readonly body: string | null;
  readonly headSha: string;
  readonly headRepository: string | null;
  readonly mergeable: boolean | null;
  readonly mergeableState: string | null;
  readonly comments: number | null;
  readonly reviewComments: number | null;
  readonly commits: number | null;
  readonly additions: number | null;
  readonly deletions: number | null;
  readonly changedFiles: number | null;
  readonly requestedReviewers: readonly string[];
  readonly mergedAt: string | null;
  readonly closedAt: string | null;
}

/** An issue or pull request as a search or a list of sub-issues shows it. */
export interface GitHubIssueHit {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly isPullRequest: boolean;
  readonly url: string;
  /** `owner/name`, read from the issue's API address. */
  readonly repository: string;
  readonly author: string | null;
  readonly labels: readonly string[];
  readonly comments: number | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly closedAt: string | null;
  readonly body: string | null;
}

/** One issue whole. */
export interface GitHubIssue extends GitHubIssueHit {
  readonly assignees: readonly string[];
  readonly milestone: string | null;
  readonly stateReason: string | null;
}

export interface GitHubComment {
  readonly id: number;
  readonly author: string | null;
  readonly body: string;
  readonly createdAt: string | null;
  readonly url: string | null;
}

export interface GitHubReview {
  readonly id: number;
  readonly author: string | null;
  readonly state: string;
  readonly body: string;
  readonly submittedAt: string | null;
  readonly url: string | null;
}

/** A comment on a line of a pull request's diff. */
export interface GitHubReviewComment extends GitHubComment {
  readonly path: string | null;
  readonly line: number | null;
  readonly inReplyTo: number | null;
}

/** A file a pull request or a commit changes, with its patch when GitHub gives one. */
export interface GitHubFile {
  readonly filename: string;
  readonly status: string;
  readonly additions: number;
  readonly deletions: number;
  readonly patch: string | null;
  readonly previousFilename: string | null;
}

export interface GitHubCommit {
  readonly sha: string;
  readonly message: string;
  readonly author: string | null;
  readonly date: string | null;
  readonly url: string | null;
  /** Its files, for one commit read whole (`getCommit`); empty in a list. */
  readonly files: readonly GitHubFile[];
}

export interface GitHubBranch {
  readonly name: string;
  readonly sha: string;
  readonly protected: boolean;
}

export interface GitHubRepository {
  readonly fullName: string;
  readonly description: string | null;
  readonly private: boolean;
  readonly archived: boolean;
  readonly defaultBranch: string | null;
  readonly url: string;
  readonly language: string | null;
  readonly updatedAt: string | null;
}

/** A commit's combined status: its state and each context's. */
export interface GitHubStatus {
  readonly state: string;
  readonly statuses: readonly {
    readonly context: string;
    readonly state: string;
    readonly description: string | null;
    readonly url: string | null;
  }[];
}

export interface GitHubCheckRun {
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly url: string | null;
  readonly completedAt: string | null;
}

/** A path's contents: a file's text (null when it is not text) or a folder's entries. */
export type GitHubContents =
  | {
      readonly kind: 'file';
      readonly path: string;
      readonly sha: string;
      readonly size: number;
      readonly text: string | null;
    }
  | {
      readonly kind: 'dir';
      readonly path: string;
      readonly entries: readonly { readonly name: string; readonly type: string; readonly size: number }[];
    };

/** A page of search results, and how many there are in all. */
export interface SearchPage<T> {
  readonly total: number;
  readonly incomplete: boolean;
  readonly items: readonly T[];
}
