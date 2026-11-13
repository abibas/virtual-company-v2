import type { GitHubRights } from '@mwc/shared/credentials';
import type { GitHubApi, GitHubSignIn, Page, RepoName } from '@mwc/tools-core';

/**
 * What one GitHub tool call works with (S7.1d): the port, the opened sign-in, the rights, and how it records a change it
 * made (an audit row as the agent, in its turn, on the pull request `owner/repo#n`); with the small helpers the tools
 * share.
 */

/** A change a tool made, as its audit rows say it. */
export interface GitHubChange {
  /** `owner/repo#n`. */
  readonly entityId: string;
  readonly changes: readonly { readonly field: string; readonly old?: unknown; readonly new: unknown }[];
}

export interface GitHubContext {
  readonly api: GitHubApi;
  readonly signIn: GitHubSignIn;
  readonly rights: GitHubRights;
  readonly audit: (change: GitHubChange) => Promise<void>;
}

/** The page a call asks for: GitHub's first page of 30 when it does not say. */
export const pageOf = (input: {
  readonly page?: number | undefined;
  readonly perPage?: number | undefined;
}): Page => ({
  page: input.page ?? 1,
  perPage: input.perPage ?? 30,
});

/** The repository a call names. */
export const repoOf = (input: { readonly owner: string; readonly repo: string }): RepoName => ({
  owner: input.owner,
  repo: input.repo,
});

/** A pull request's audit id: `owner/repo#n`. */
export const pullId = (repo: RepoName, number: number) => `${repo.owner}/${repo.repo}#${number}`;
