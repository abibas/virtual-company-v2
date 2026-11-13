import { slackClient } from '@mwc/slack';
import type { SlackApi } from '@mwc/tools-core';

/**
 * The Slack connector for the agents' Slack tools (S7.1e), wired here so no module imports it: Slack's Web API through the
 * server's provider client (tests pass a fake; NODE_ENV=test refuses every call), with deadlines that keep a tool's
 * answer inside the runner's 55 s wait: 15 s an attempt, a rate limit retried twice after at most 5 s.
 */

export const SLACK_TIMEOUT_MS = 15_000;
export const SLACK_MAX_WAIT_MS = 5_000;

export function slackFor(fetch: typeof globalThis.fetch): SlackApi {
  return slackClient({
    fetch: (url, init) => fetch(url, init),
    timeoutMs: SLACK_TIMEOUT_MS,
    maxWaitMs: SLACK_MAX_WAIT_MS,
  });
}
