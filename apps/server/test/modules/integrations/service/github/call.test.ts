import type { TenantDb } from '@mwc/db';
import { githubClient } from '@mwc/github';
import type { GitHubRights } from '@mwc/shared/credentials';
import { captureLogger } from '@mwc/testkit';
import { describe, expect, it } from 'vitest';
import type { ServerToolTurn } from '../../../../../src/modules/chats/index.ts';
import type { CredentialsForTools } from '../../../../../src/modules/credentials/index.ts';
import type { IntegrationsRepo } from '../../../../../src/modules/integrations/repo.ts';
import {
  callGitHub,
  type GitHubCallDeps,
  NO_AGENT,
  NO_PART,
  NO_PROFILE,
  NO_SIGN_IN,
} from '../../../../../src/modules/integrations/service/github/call.ts';
import { githubTools } from '../../../../../src/modules/integrations/service/github/hook.ts';
import { TOOL_FAILED } from '../../../../../src/modules/integrations/service/reply.ts';
import { integrationTools, NOT_OURS } from '../../../../../src/modules/integrations/service/tools.ts';

/**
 * One GitHub call's checks and GitHub's refusals (S7.1d), on fakes: the repo, the credentials' side and a fetch behind the
 * real connector. The live path through a turn is `pulls.test.ts` and `repos.test.ts`.
 */

const t = { companyId: 'company-1' } as TenantDb;
const TURN: ServerToolTurn = {
  turnId: 'turn-1',
  chatId: 'chat-1',
  agentPrincipalId: 'agent-p',
  profileId: '0195f0a0-0000-7000-8000-000000000009',
  by: 'person-p',
};
const READ: GitHubRights = { repos: ['acme/*'], push: false, pullRequests: false };
const BRANCHES = [{ name: 'main', commit: { sha: 'c1' } }];

type Answer = { readonly status: number; readonly body?: unknown; readonly headers?: Record<string, string> };

/** The call's deps on fakes; `answers` are the fetch's, in turn. */
function world(options: { answers?: Answer[]; part?: unknown; agent?: unknown; opened?: unknown } = {}) {
  const answers = [...(options.answers ?? [{ status: 200, body: BRANCHES }])];
  const fetched: string[] = [];
  const marked: string[] = [];
  const opened: unknown[] = [];
  const part =
    'part' in options
      ? options.part
      : { ownerUserId: 'owner-1', credentialId: 'cred-1', rights: READ, site: null, account: null };
  const repo = {
    githubPart: async () => part,
    agentOf: async () => ('agent' in options ? options.agent : { id: 'agent-1' }),
    audit: async () => undefined,
  } as unknown as IntegrationsRepo;
  const credentials = {
    github: async (...args: unknown[]) => {
      opened.push(args);
      return options.opened ?? { ok: true, signIn: { token: 'ghp_x' } };
    },
    needsSignIn: async (credentialId: string) => void marked.push(credentialId),
  } as unknown as CredentialsForTools;
  const fetch = async (url: string) => {
    fetched.push(url);
    const answer = answers.length > 1 ? answers.shift() : answers[0];
    const { status, body, headers } = answer as Answer;
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: headers ?? {} });
  };
  const api = githubClient({ fetch, sleep: async () => undefined });
  const deps: GitHubCallDeps = { api, credentials, repo };
  return { deps, fetched, marked, opened };
}

const call = (tool: string, input: Record<string, unknown> = { owner: 'acme', repo: 'web' }) => ({
  callId: 'c-1',
  tool,
  input,
});

describe('a GitHub call’s checks', () => {
  it('opens the sign-in for tool:<name> in the company, for the agent, chat and sender, then answers', async () => {
    const w = world();
    const result = await callGitHub(w.deps, t, TURN, call('list_branches'));
    expect(result.ok).toBe(true);
    expect(w.opened).toEqual([
      [
        'cred-1',
        'owner-1',
        {
          purpose: 'tool:list_branches',
          companyId: 'company-1',
          agentId: 'agent-1',
          chatId: 'chat-1',
          principalId: 'person-p',
        },
      ],
    ]);
  });

  it('refuses before opening anything: another tool, no profile, no part, rights, no sign-in, no agent', async () => {
    const unsigned = { ownerUserId: 'o', credentialId: null, rights: READ, site: null, account: null };
    const cases: [ReturnType<typeof world>, ServerToolTurn, string, string][] = [
      [world(), TURN, 'merge_pull_request', 'Unknown tool: merge_pull_request'],
      [world(), { ...TURN, profileId: null }, 'list_branches', NO_PROFILE],
      [world({ part: undefined }), TURN, 'list_branches', NO_PART],
      [
        world(),
        TURN,
        'create_pull_request',
        "Pull requests are off for this agent's profile: it may only read.",
      ],
      [world({ part: unsigned }), TURN, 'list_branches', NO_SIGN_IN],
      [world({ agent: undefined }), TURN, 'list_branches', NO_AGENT],
    ];
    for (const [w, turn, tool, text] of cases) {
      expect(await callGitHub(w.deps, t, turn, call(tool))).toEqual({ ok: false, text });
      expect(w.opened).toEqual([]);
      expect(w.fetched).toEqual([]);
    }
  });

  it('refuses a repository outside the allowlist, an argument not offered and a bad input, by name', async () => {
    const w = world({
      part: {
        ownerUserId: 'o',
        credentialId: 'c',
        rights: { ...READ, pullRequests: true },
        site: null,
        account: null,
      },
    });
    const outside = await callGitHub(w.deps, t, TURN, call('list_branches', { owner: 'other', repo: 'x' }));
    expect(outside.text).toBe(
      "other/x is outside the GitHub repositories this agent's profile reaches (acme/*).",
    );
    const closing = await callGitHub(
      w.deps,
      t,
      TURN,
      call('update_pull_request', { owner: 'acme', repo: 'web', pullNumber: 1, state: 'closed' }),
    );
    expect(closing.text).toBe('Closing or reopening a pull request is not offered: nothing here closes one.');
    const reaction = await callGitHub(
      w.deps,
      t,
      TURN,
      call('add_issue_comment', { owner: 'acme', repo: 'web', issue_number: 1, reaction: '+1' }),
    );
    expect(reaction.text).toBe('Reactions are not offered: write a comment with body.');
    const bad = await callGitHub(w.deps, t, TURN, call('pull_request_read', { owner: 'acme', repo: 'web' }));
    expect(bad.text).toMatch(/^pull_request_read did nothing; fix its input and call it again:\n/);
    const nothing = await callGitHub(
      w.deps,
      t,
      TURN,
      call('update_pull_request', { owner: 'acme', repo: 'web', pullNumber: 1 }),
    );
    expect(nothing.text).toContain('give at least one of title, body, base and draft');
    expect(w.fetched).toEqual([]);
  });

  it('passes on why the sign-in did not open', async () => {
    const w = world({ opened: { ok: false, message: 'revoked: sign in again' } });
    expect(await callGitHub(w.deps, t, TURN, call('list_branches'))).toEqual({
      ok: false,
      text: 'revoked: sign in again',
    });
  });
});

describe('GitHub’s refusals, in words', () => {
  it('401: says to sign in again and marks the sign-in as needing one', async () => {
    const w = world({ answers: [{ status: 401, body: { message: 'Bad credentials' } }] });
    const result = await callGitHub(w.deps, t, TURN, call('list_branches'));
    expect(result).toEqual({
      ok: false,
      text: 'GitHub refused the sign-in (401): its owner needs to sign in again on the Subscriptions page.',
    });
    expect(w.marked).toEqual(['cred-1']);
  });

  it('403 with GitHub’s words, 404 plainly, marking nothing', async () => {
    const forbidden = world({ answers: [{ status: 403, body: { message: 'Must have admin rights.' } }] });
    expect((await callGitHub(forbidden.deps, t, TURN, call('list_branches'))).text).toBe(
      'GitHub says the account has no permission for this (403). Must have admin rights.',
    );
    const missing = world({ answers: [{ status: 404, body: { message: 'Not Found' } }] });
    expect((await callGitHub(missing.deps, t, TURN, call('list_branches'))).text).toBe(
      'GitHub found nothing there, or the account cannot see it (404).',
    );
    expect([...forbidden.marked, ...missing.marked]).toEqual([]);
  });

  it('a rate limit: retried after Retry-After, then refused saying when', async () => {
    const limited = { status: 429, headers: { 'retry-after': '0' } };
    const later = world({ answers: [limited, { status: 200, body: BRANCHES }] });
    expect((await callGitHub(later.deps, t, TURN, call('list_branches'))).ok).toBe(true);
    const never = world({ answers: [{ status: 429, headers: { 'retry-after': '3' } }] });
    expect((await callGitHub(never.deps, t, TURN, call('list_branches'))).text).toBe(
      'GitHub is limiting requests. Try again in 3 s.',
    );
    expect(never.fetched).toHaveLength(3);
  });
});

describe('the hooks', () => {
  const down = new Proxy(
    {},
    {
      get: () => {
        throw new Error('the database is down');
      },
    },
  ) as TenantDb;
  const base = { db: {} as never, keyring: {} as never, clock: () => new Date() };

  it('GitHub’s owns its tools only, and answers a failure on the server in words, never throwing', async () => {
    const { logger, lines } = captureLogger();
    const hook = githubTools({ ...base, logger, github: {} as never });
    expect(hook.owns('pull_request_read')).toBe(true);
    expect(hook.owns('getJiraIssue')).toBe(false);
    expect(await hook.toolsFor(down, { profileId: TURN.profileId as string })).toEqual({ tools: [] });
    expect(await hook.tool(down, TURN, call('list_branches'))).toEqual({ ok: false, text: TOOL_FAILED });
    expect(lines.map((line) => line.msg)).toEqual([
      'integrations: could not offer the GitHub tools',
      'integrations: a GitHub tool failed',
    ]);
  });

  it('the merged one owns both tools’ names and sends a call to its owner, refusing any other', async () => {
    const { logger } = captureLogger();
    const hook = integrationTools({ ...base, logger, github: {} as never, atlassian: {} as never });
    expect(hook.owns('pull_request_read') && hook.owns('getJiraIssue')).toBe(true);
    expect(hook.owns('task_read')).toBe(false);
    expect(await hook.tool(down, TURN, call('task_read'))).toEqual({ ok: false, text: NOT_OURS });
    expect(await hook.tool(down, TURN, call('getJiraIssue'))).toEqual({ ok: false, text: TOOL_FAILED });
  });
});
