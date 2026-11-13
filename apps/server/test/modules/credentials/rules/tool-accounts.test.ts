import { describe, expect, it } from 'vitest';
import {
  atlassianAccount,
  atlassianMeta,
  githubAccount,
  githubMeta,
  githubScopes,
  githubTokenType,
  includedAnswer,
  slackAccount,
  slackMeta,
} from '../../../../src/modules/credentials/rules/tool-accounts.ts';

describe('GitHub', () => {
  it('reads the scopes header, and none for a fine-grained token', () => {
    expect(githubScopes('repo, read:org,gist , workflow')).toEqual(['repo', 'read:org', 'gist', 'workflow']);
    expect(githubScopes('')).toEqual([]);
    expect(githubScopes(null)).toBeNull();
    expect(githubScopes(undefined)).toBeNull();
  });

  it('reads the account from GET /user, and nothing without a login', () => {
    expect(githubAccount({ login: 'ihor', name: 'Ihor', email: 'ihor@example.com', id: 1 }, 'repo')).toEqual({
      login: 'ihor',
      name: 'Ihor',
      email: 'ihor@example.com',
      scopes: ['repo'],
    });
    expect(githubAccount({ login: 'ihor', name: '', email: null }, null)).toEqual({
      login: 'ihor',
      name: null,
      email: null,
      scopes: null,
    });
    expect(githubAccount({ name: 'Nobody' }, 'repo')).toBeUndefined();
    expect(githubAccount({ login: 42 }, 'repo')).toBeUndefined();
  });

  it('keeps the host, login, name, scopes and a pasted token’s type as the account details', () => {
    const account = { login: 'ihor', name: null, email: null, scopes: null };
    expect(githubMeta(account)).toEqual({ host: 'github.com', login: 'ihor' });
    expect(githubMeta({ ...account, name: 'Ihor', scopes: ['repo'] }, 'classic')).toEqual({
      host: 'github.com',
      login: 'ihor',
      name: 'Ihor',
      scopes: ['repo'],
      tokenType: 'classic',
    });
    expect(githubTokenType('github_pat_11ABC')).toBe('fine_grained');
    expect(githubTokenType('ghp_abc')).toBe('classic');
  });

  it('reads `gh api --include` output: the status, the headers by lower-case name, the body', () => {
    const answer = includedAnswer(
      'HTTP/2.0 200 OK\r\nX-Oauth-Scopes: repo, gist\r\nContent-Type: application/json\r\nbroken line\r\n\r\n{"login":"ihor"}',
    );
    expect(answer?.status).toBe(200);
    expect(answer?.headers.get('x-oauth-scopes')).toBe('repo, gist');
    expect(answer?.headers.has('broken line')).toBe(false);
    expect(answer?.body).toBe('{"login":"ihor"}');
    expect(includedAnswer('HTTP/1.1 401 Unauthorized\n')).toMatchObject({ status: 401, body: '' });
    expect(includedAnswer('{"login":"ihor"}')).toBeUndefined();
    expect(includedAnswer('')).toBeUndefined();
  });
});

describe('Atlassian', () => {
  const jira = { accountId: 'jira-1', displayName: 'Ihor H', emailAddress: 'ihor@example.com' };
  const confluence = { type: 'known', accountId: 'conf-1', displayName: 'Ihor C', publicName: 'ihor' };

  it('counts each product that names the account, Jira’s names first', () => {
    expect(atlassianAccount(jira, confluence)).toEqual({
      jira: true,
      confluence: true,
      accountId: 'jira-1',
      displayName: 'Ihor H',
    });
    expect(atlassianAccount(undefined, confluence)).toEqual({
      jira: false,
      confluence: true,
      accountId: 'conf-1',
      displayName: 'Ihor C',
    });
    expect(atlassianAccount(undefined, { type: 'known', accountId: 'c', publicName: 'pub' })).toMatchObject({
      displayName: 'pub',
    });
  });

  it('takes Confluence’s anonymous user for no answer', () => {
    expect(atlassianAccount(jira, { type: 'anonymous', displayName: 'Anonymous' })).toEqual({
      jira: true,
      confluence: false,
      accountId: 'jira-1',
      displayName: 'Ihor H',
    });
    expect(atlassianAccount(undefined, { type: 'anonymous' })).toEqual({
      jira: false,
      confluence: false,
      accountId: null,
      displayName: null,
    });
  });

  it('keeps the site, the products and who the account is as the account details', () => {
    expect(atlassianMeta('airia.atlassian.net', atlassianAccount(jira, undefined))).toEqual({
      site: 'airia.atlassian.net',
      jira: true,
      confluence: false,
      accountId: 'jira-1',
      displayName: 'Ihor H',
    });
    expect(atlassianMeta('x.atlassian.net', atlassianAccount(undefined, { type: 'known' }))).toEqual({
      site: 'x.atlassian.net',
      jira: false,
      confluence: true,
    });
  });
});

describe('Slack', () => {
  const auth = { ok: true, team: 'Airia', team_id: 'T1', user: 'mw-bot', user_id: 'U1', bot_id: 'B1' };

  it('reads auth.test and its scopes header, and nothing without a workspace or user', () => {
    expect(slackAccount(auth, 'chat:write, channels:read')).toEqual({
      team: 'Airia',
      teamId: 'T1',
      url: null,
      user: 'mw-bot',
      userId: 'U1',
      botId: 'B1',
      enterpriseId: null,
      scopes: ['chat:write', 'channels:read'],
    });
    expect(slackAccount({ ...auth, bot_id: undefined, enterprise_id: 'E1' }, null)).toMatchObject({
      botId: null,
      enterpriseId: 'E1',
      scopes: [],
    });
    expect(slackAccount({ ...auth, team: '' }, null)).toBeUndefined();
    expect(slackAccount({ ...auth, user_id: 7 }, null)).toBeUndefined();
  });

  it('keeps the set details only', () => {
    const account = slackAccount({ ...auth, url: 'https://airia.slack.com/' }, null);
    expect(account && slackMeta(account)).toEqual({
      team: 'Airia',
      teamId: 'T1',
      url: 'https://airia.slack.com/',
      user: 'mw-bot',
      userId: 'U1',
      botId: 'B1',
      scopes: [],
    });
  });
});
