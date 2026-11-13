import { githubClient } from '@mwc/github';
import type { GitHubApi } from '@mwc/tools-core';

/**
 * The GitHub connector for the agents' GitHub tools (S7.1d), wired here so no module imports it: GitHub's REST API through
 * the server's provider client (tests pass a fake; NODE_ENV=test refuses every call), with deadlines that keep a tool's
 * answer inside the runner's 55 s wait: 15 s an attempt, a rate limit retried twice after at most 5 s.
 */

export const GITHUB_TIMEOUT_MS = 15_000;
export const GITHUB_MAX_WAIT_MS = 5_000;

export function githubFor(fetch: typeof globalThis.fetch): GitHubApi {
  return githubClient({
    fetch: (url, init) => fetch(url, init),
    timeoutMs: GITHUB_TIMEOUT_MS,
    maxWaitMs: GITHUB_MAX_WAIT_MS,
  });
}
