import { atlassianClient } from '@mwc/atlassian';
import type { TenantDb } from '@mwc/db';
import type { AtlassianRights } from '@mwc/shared/credentials';
import { captureLogger } from '@mwc/testkit';
import { describe, expect, it } from 'vitest';
import type { ServerToolTurn } from '../../../../../src/modules/chats/index.ts';
import type { CredentialsForTools } from '../../../../../src/modules/credentials/index.ts';
import type { IntegrationsRepo } from '../../../../../src/modules/integrations/repo.ts';
import {
  type AtlassianCallDeps,
  callAtlassian,
  NO_AGENT,
  NO_PART,
  NO_PROFILE,
  NO_SIGN_IN,
} from '../../../../../src/modules/integrations/service/atlassian/call.ts';
import {
  atlassianTools,
  TOOL_FAILED,
} from '../../../../../src/modules/integrations/service/atlassian/hook.ts';

/**
 * One Atlassian call's checks and Atlassian's refusals (S7.1c), on fakes: the repo, the credentials' side and a fetch
 * behind the real connector. The live path through a turn is `jira.test.ts` and `confluence.test.ts`.
 */

const t = { companyId: 'company-1' } as TenantDb;
const TURN: ServerToolTurn = {
  turnId: 'turn-1',
  chatId: 'chat-1',
  agentPrincipalId: 'agent-p',
  profileId: '0195f0a0-0000-7000-8000-000000000009',
  by: 'person-p',
};
const READ: AtlassianRights = { jira: 'read', jiraProjects: 'all', confluence: 'off', confluenceSpaces: [] };
const SIGN_IN = { site: 'acme.atlassian.net', email: 'e@example.com', token: 'tok' };
const ISSUE = { key: 'AP-1', fields: { summary: 'One', project: { key: 'AP' } } };

type Answer = { readonly status: number; readonly body?: unknown; readonly headers?: Record<string, string> };

/** The call's deps on fakes; `answers` are the fetch's, in turn. */
function world(options: { answers?: Answer[]; part?: unknown; agent?: unknown; opened?: unknown } = {}) {
  const answers = [...(options.answers ?? [{ status: 200, body: ISSUE }])];
  const fetched: string[] = [];
  const marked: string[] = [];
  const opened: unknown[] = [];
  const part =
    'part' in options
      ? options.part
      : { ownerUserId: 'owner-1', credentialId: 'cred-1', rights: READ, site: null, account: null };
  const repo = {
    atlassianPart: async () => part,
    agentOf: async () => ('agent' in options ? options.agent : { id: 'agent-1' }),
    audit: async () => undefined,
  } as unknown as IntegrationsRepo;
  const credentials = {
    atlassian: async (...args: unknown[]) => {
      opened.push(args);
      return options.opened ?? { ok: true, signIn: SIGN_IN };
    },
    needsSignIn: async (credentialId: string) => void marked.push(credentialId),
  } as unknown as CredentialsForTools;
  const fetch = async (url: string) => {
    fetched.push(url);
    const answer = answers.length > 1 ? answers.shift() : answers[0];
    const { status, body, headers } = answer as Answer;
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: headers ?? {} });
  };
  const api = atlassianClient({ fetch, sleep: async () => undefined });
  const deps: AtlassianCallDeps = { api, credentials, repo };
  return { deps, fetched, marked, opened };
}

const call = (tool: string, input: Record<string, unknown> = { issueIdOrKey: 'AP-1' }) => ({
  callId: 'c-1',
  tool,
  input,
});

describe('an Atlassian call’s checks', () => {
  it('opens the sign-in for tool:<name> in the company, for the agent, chat and sender, then answers', async () => {
    const w = world();
    const result = await callAtlassian(w.deps, t, TURN, call('getJiraIssue'));
    expect(result.ok).toBe(true);
    expect(w.opened).toEqual([
      [
        'cred-1',
        'owner-1',
        {
          purpose: 'tool:getJiraIssue',
          companyId: 'company-1',
          agentId: 'agent-1',
          chatId: 'chat-1',
          principalId: 'person-p',
        },
      ],
    ]);
  });

  it('refuses before opening anything: another tool, no profile, no part, no sign-in, no agent', async () => {
    const cases: [ReturnType<typeof world>, ServerToolTurn, string, string][] = [
      [world(), TURN, 'task_read', 'Unknown tool: task_read'],
      [world(), { ...TURN, profileId: null }, 'getJiraIssue', NO_PROFILE],
      [world({ part: undefined }), TURN, 'getJiraIssue', NO_PART],
      [
        world({ part: { ownerUserId: 'o', credentialId: null, rights: READ, site: null, account: null } }),
        TURN,
        'getJiraIssue',
        NO_SIGN_IN,
      ],
      [world({ agent: undefined }), TURN, 'getJiraIssue', NO_AGENT],
    ];
    for (const [w, turn, tool, text] of cases) {
      expect(await callAtlassian(w.deps, t, turn, call(tool))).toEqual({ ok: false, text });
      expect(w.fetched).toEqual([]);
    }
  });

  it('passes on why the sign-in did not open', async () => {
    const w = world({ opened: { ok: false, message: 'revoked: sign in again' } });
    expect(await callAtlassian(w.deps, t, TURN, call('getJiraIssue'))).toEqual({
      ok: false,
      text: 'revoked: sign in again',
    });
  });
});

describe('Atlassian’s refusals, in words', () => {
  it('401: says to sign in again and marks the sign-in as needing one', async () => {
    const w = world({ answers: [{ status: 401 }] });
    const result = await callAtlassian(w.deps, t, TURN, call('getJiraIssue'));
    expect(result.ok).toBe(false);
    expect(result.text).toContain('needs to sign in again');
    expect(w.marked).toEqual(['cred-1']);
  });

  it('403 and 404 say so with Atlassian’s own words, marking nothing', async () => {
    const forbidden = world({
      answers: [{ status: 403, body: { errorMessages: ['You cannot browse AP.'] } }],
    });
    expect((await callAtlassian(forbidden.deps, t, TURN, call('getJiraIssue'))).text).toBe(
      'Jira says the Atlassian account has no permission for this (403). You cannot browse AP.',
    );
    const missing = world({ answers: [{ status: 404, body: { errorMessages: ['Issue does not exist'] } }] });
    expect((await callAtlassian(missing.deps, t, TURN, call('getJiraIssue'))).text).toBe(
      'Jira found nothing there, or the Atlassian account cannot see it (404). Issue does not exist',
    );
    expect([...forbidden.marked, ...missing.marked]).toEqual([]);
  });

  it('429: retried after Retry-After, then rate limited when it goes on', async () => {
    const limited = { status: 429, headers: { 'retry-after': '0' } };
    const later = world({ answers: [limited, { status: 200, body: ISSUE }] });
    expect((await callAtlassian(later.deps, t, TURN, call('getJiraIssue'))).ok).toBe(true);
    expect(later.fetched).toHaveLength(2);
    const never = world({ answers: [limited] });
    expect((await callAtlassian(never.deps, t, TURN, call('getJiraIssue'))).text).toBe(
      'Jira is limiting requests (429); wait a minute and try again.',
    );
    expect(never.fetched).toHaveLength(3);
  });
});

describe('the hook', () => {
  it('owns the Atlassian tools only, and answers a failure on the server in words, never throwing', async () => {
    const { logger, lines } = captureLogger();
    const hook = atlassianTools({
      db: {} as never,
      keyring: {} as never,
      clock: () => new Date(),
      logger,
      atlassian: {} as never,
    });
    expect(hook.owns('getJiraIssue')).toBe(true);
    expect(hook.owns('task_read')).toBe(false);
    const down = new Proxy(
      {},
      {
        get: () => {
          throw new Error('the database is down');
        },
      },
    ) as TenantDb;
    expect(await hook.toolsFor(down, { profileId: TURN.profileId as string })).toEqual({ tools: [] });
    expect(await hook.tool(down, TURN, call('getJiraIssue'))).toEqual({ ok: false, text: TOOL_FAILED });
    expect(lines.map((line) => line.msg)).toEqual([
      'integrations: could not offer the Atlassian tools',
      'integrations: an Atlassian tool failed',
    ]);
  });
});
