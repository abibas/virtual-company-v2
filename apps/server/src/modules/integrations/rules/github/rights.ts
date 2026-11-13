import type { GitHubRights } from '@mwc/shared/credentials';
import { GITHUB_PR_TOOLS, GITHUB_READ_TOOLS, type GitHubTool } from '../../schemas/github.ts';

/**
 * Which GitHub tools a profile's GitHub part gives (S7.1d), and the server's check of each call against it: the read
 * tools while it reaches a repository, the pull request tools only with `pullRequests`; and the repositories allowlist
 * (`all`, or `owner/name` and `owner/*`, case ignored), checked on every tool that names a repository and on each search's
 * results. A refusal is a sentence the agent reads.
 */

type Repos = GitHubRights['repos'];

const has = (list: readonly string[], tool: GitHubTool) => list.includes(tool);

/** True when the part reaches some repository. */
export const reachesAny = (repos: Repos) => repos === 'all' || repos.length > 0;

export const isPullRequestTool = (tool: GitHubTool) => has(GITHUB_PR_TOOLS, tool);

/** The tools the rights give, in a fixed order. */
export function offeredGitHubTools(rights: GitHubRights): GitHubTool[] {
  if (!reachesAny(rights.repos)) return [];
  return [...GITHUB_READ_TOOLS, ...(rights.pullRequests ? GITHUB_PR_TOOLS : [])];
}

/** Why the rights refuse the tool now, or undefined when they give it. */
export function githubRefusal(tool: GitHubTool, rights: GitHubRights): string | undefined {
  if (!reachesAny(rights.repos)) return "This agent's profile reaches no GitHub repository.";
  if (isPullRequestTool(tool) && !rights.pullRequests)
    return "Pull requests are off for this agent's profile: it may only read.";
  return undefined;
}

/** True when the allowlist holds the repository (`owner/name` or `owner/*`, case ignored). */
export function repoInScope(repos: Repos, owner: string, name: string): boolean {
  if (repos === 'all') return true;
  const full = `${owner}/${name}`.toLowerCase();
  const any = `${owner}/*`.toLowerCase();
  return repos.some((entry) => [full, any].includes(entry.toLowerCase()));
}

/** True when the allowlist holds every repository of the owner (`owner/*`). */
export const ownerInScope = (repos: Repos, owner: string): boolean => repoInScope(repos, owner, '*');

/** `owner/name` read from a full name; undefined for anything else. */
export function splitRepo(fullName: string): { readonly owner: string; readonly name: string } | undefined {
  const [owner, name, more] = fullName.split('/');
  return owner && name && more === undefined ? { owner, name } : undefined;
}

/** True when a full name (`owner/name`) is in the allowlist. */
export const fullNameInScope = (repos: Repos, fullName: string): boolean => {
  const repo = splitRepo(fullName);
  return repo !== undefined && repoInScope(repos, repo.owner, repo.name);
};

/** The allowlist in words: "AiriaLLC/*, abibas/sandbox". */
export const reposWords = (repos: readonly string[]) => repos.join(', ');

/** Something outside the profile's repositories. */
export const outsideRepos = (what: string, repos: readonly string[]) =>
  `${what} is outside the GitHub repositories this agent's profile reaches (${reposWords(repos)}).`;
