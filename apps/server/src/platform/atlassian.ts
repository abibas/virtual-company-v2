import { atlassianClient } from '@mwc/atlassian';
import type { AtlassianApi } from '@mwc/tools-core';

/**
 * The Atlassian connector for the agents' Atlassian tools (S7.1c), wired here so no module imports it: Jira's and
 * Confluence's REST APIs through the server's provider client (tests pass a fake; NODE_ENV=test refuses every call),
 * with deadlines that keep a tool's answer inside the runner's 55 s wait: 15 s an attempt, a 429 retried twice after at
 * most 5 s.
 */

export const ATLASSIAN_TIMEOUT_MS = 15_000;
export const ATLASSIAN_MAX_WAIT_MS = 5_000;

export function atlassianFor(fetch: typeof globalThis.fetch): AtlassianApi {
  return atlassianClient({
    fetch: (url, init) => fetch(url, init),
    timeoutMs: ATLASSIAN_TIMEOUT_MS,
    maxWaitMs: ATLASSIAN_MAX_WAIT_MS,
  });
}
