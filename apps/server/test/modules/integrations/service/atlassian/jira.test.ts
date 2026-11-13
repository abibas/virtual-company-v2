import { credentials } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { AtlassianRights } from '@mwc/shared/credentials';
import type { TurnStart } from '@mwc/shared/runner-protocol';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SIGN_IN_REVOKED } from '../../../../../src/modules/credentials/service/tool-use.ts';
import { SEARCH_FIELDS } from '../../../../../src/modules/integrations/service/atlassian/jira.ts';
import { type ChatsWorld, chatsWorld, turnRow, usesOf } from '../../../../fixtures/chats/world.ts';
import { json } from '../../../../fixtures/credentials/providers.ts';
import {
  type AtlassianScene,
  answerIssue,
  answerOf,
  atlassianScene,
  atlassianTurn,
  callTool,
  JIRA,
  principalOf,
  putAtlassianPart,
  rawIssue,
  statusOf,
  toolAudit,
} from '../../../../fixtures/integrations/atlassian.ts';

/**
 * The Jira tools through a live turn (S7.1c): the runner relays each call, the server checks the profile's rights and
 * projects, calls the fake Jira with the sealed sign-in, records the use and audits each change as the agent. One turn
 * serves every test; the profile's part is changed between calls, since each call reads it again.
 */

let w: ChatsWorld;
let s: AtlassianScene;
let start: TurnStart;
const CHANGES: AtlassianRights = {
  jira: 'changes',
  jiraProjects: ['AP'],
  confluence: 'off',
  confluenceSpaces: [],
};
const AUTH = `Basic ${Buffer.from('ihor@example.com:ATATT3ATLASSIANtokenNEVERshown').toString('base64')}`;

const rights = (changed: Partial<AtlassianRights>) =>
  putAtlassianPart(w.t.db, s.profile.id, { credentialId: s.signIn.id, rights: { ...CHANGES, ...changed } });

beforeAll(async () => {
  w = await chatsWorld();
});
/** The scene and its turn, made by the first test that needs them (a hook's 10 s are short on a loaded machine). */
let made: Promise<void> | undefined;
beforeEach(async () => {
  made ??= (async () => {
    s = await atlassianScene(w, { rights: CHANGES });
    start = await atlassianTurn(w, s);
  })();
  await made;
}, 20_000);
afterEach(async () => {
  w.provider.reset();
  await rights({});
});
afterAll(async () => {
  await w.disconnectAll();
  await w.close();
});

describe('searchJiraIssuesUsingJql', () => {
  it('ANDs the JQL with the profile’s projects, keeps ORDER BY last and drops issues outside them', async () => {
    w.provider.route(
      'POST',
      `${JIRA}/search/jql`,
      json(200, { issues: [rawIssue('AP-301', 'AP'), rawIssue('X-9', 'X')], nextPageToken: 'n-2' }),
    );
    const result = await callTool(s, start, 'searchJiraIssuesUsingJql', {
      cloudId: 'airia',
      jql: 'assignee = currentUser() ORDER BY updated DESC',
      maxResults: 5,
    });
    expect(result.ok).toBe(true);
    const sent = 'project in ("AP") AND (assignee = currentUser()) ORDER BY updated DESC';
    expect(answerOf(result)).toMatchObject({ jql: sent, nextPageToken: 'n-2' });
    expect((answerOf(result).issues as { key: string }[]).map((issue) => issue.key)).toEqual(['AP-301']);
    const [call] = w.provider.calls;
    expect(call).toMatchObject({ method: 'POST', headers: { authorization: AUTH } });
    expect(call?.body).toEqual({ jql: sent, fields: SEARCH_FIELDS, maxResults: 5 });
    expect(result.text).not.toContain('ATLASSIANtoken');
  });

  it('records the use of the sign-in for the tool, in the company, for the agent, chat and sender', async () => {
    w.provider.route('POST', `${JIRA}/search/jql`, json(200, { issues: [] }));
    await callTool(s, start, 'searchJiraIssuesUsingJql', { jql: 'project = AP' });
    const use = (await usesOf(w.t.db, s.signIn.id)).at(-1);
    const turn = await turnRow(w.t.db, start.turnId);
    expect(use).toMatchObject({
      purpose: 'tool:searchJiraIssuesUsingJql',
      companyId: s.company.companyId,
      agentId: s.agentId,
      chatId: s.chat.id,
      principalId: turn?.createdBy,
    });
  });

  it('refuses a JQL that would reach past its group, asking nothing of Jira', async () => {
    const result = await callTool(s, start, 'searchJiraIssuesUsingJql', {
      jql: 'project = X) OR (project = Y',
    });
    expect(result).toMatchObject({
      ok: false,
      text: 'The JQL cannot be used as written: it closes a parenthesis it never opened.',
    });
    expect(w.provider.calls).toEqual([]);
  });

  it('sends the JQL as it is when the profile reaches every project', async () => {
    await rights({ jiraProjects: 'all' });
    w.provider.route('POST', `${JIRA}/search/jql`, json(200, { issues: [rawIssue('X-9', 'X')] }));
    const result = await callTool(s, start, 'searchJiraIssuesUsingJql', {
      jql: 'key = X-9',
      fields: ['summary'],
    });
    expect(w.provider.calls[0]?.body).toEqual({
      jql: 'key = X-9',
      fields: ['summary', 'project'],
      maxResults: 25,
    });
    expect((answerOf(result).issues as unknown[]).length).toBe(1);
  });
});

describe('the other read tools', () => {
  it('getJiraIssue reads an issue of the profile’s projects and refuses one outside them', async () => {
    answerIssue(w, 'AP-301', 'AP');
    answerIssue(w, 'X-9', 'X');
    const read = await callTool(s, start, 'getJiraIssue', {
      cloudId: 'x',
      issueIdOrKey: 'ap-301',
      expand: 'names',
    });
    expect(answerOf(read)).toMatchObject({
      key: 'AP-301',
      summary: 'Issue AP-301',
      description: 'About AP-301.',
    });
    expect(w.provider.calls[0]?.url).toContain('/issue/AP-301?fields=summary%2Cdescription');
    const outside = await callTool(s, start, 'getJiraIssue', { issueIdOrKey: 'X-9' });
    expect(outside).toEqual(
      expect.objectContaining({
        ok: false,
        text: "X-9 is in project X, outside the Jira projects this agent's profile reaches (AP).",
      }),
    );
  });

  it('getTransitionsForJiraIssue checks the issue’s project first, then lists them', async () => {
    answerIssue(w, 'AP-301', 'AP');
    w.provider.route(
      'GET',
      `${JIRA}/issue/AP-301/transitions`,
      json(200, { transitions: [{ id: '31', name: 'Done', to: { name: 'Done' } }] }),
    );
    const result = await callTool(s, start, 'getTransitionsForJiraIssue', { issueIdOrKey: 'AP-301' });
    expect(answerOf(result)).toEqual({ transitions: [{ id: '31', name: 'Done', to: 'Done' }] });
    expect(w.provider.calls.map((call) => call.url.split('?')[0])).toEqual([
      `${JIRA}/issue/AP-301`,
      `${JIRA}/issue/AP-301/transitions`,
    ]);
  });

  it('getVisibleJiraProjects lists only the profile’s; lookupJiraAccountId finds people', async () => {
    w.provider.route(
      'GET',
      `${JIRA}/project/search`,
      json(200, {
        values: [
          { id: '1', key: 'AP', name: 'Platform' },
          { id: '2', key: 'X', name: 'Other' },
        ],
      }),
    );
    w.provider.route('GET', `${JIRA}/user/search`, json(200, [{ accountId: 'u-1', displayName: 'Ihor' }]));
    const projects = await callTool(s, start, 'getVisibleJiraProjects', { searchString: 'a' });
    expect((answerOf(projects).projects as { key: string }[]).map((project) => project.key)).toEqual(['AP']);
    const people = await callTool(s, start, 'lookupJiraAccountId', { searchString: 'Ihor' });
    expect(answerOf(people)).toEqual({
      users: [{ accountId: 'u-1', displayName: 'Ihor', email: null, active: true }],
    });
  });

  it('a bad input is a tool error saying what to fix', async () => {
    const result = await callTool(s, start, 'getJiraIssue', { issueIdOrKey: 'not a key' });
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(
      /^getJiraIssue did nothing; fix its input and call it again:\nissueIdOrKey: /,
    );
  });
});

describe('the change tools', () => {
  it('are refused while Jira is read only, off, or reaches no project', async () => {
    await rights({ jira: 'read' });
    const comment = { issueIdOrKey: 'AP-301', commentBody: 'Done.' };
    expect(await callTool(s, start, 'addCommentToJiraIssue', comment)).toMatchObject({
      ok: false,
      text: "Jira changes are off for this agent's profile: it may only read.",
    });
    await rights({ jira: 'off' });
    expect((await callTool(s, start, 'getJiraIssue', { issueIdOrKey: 'AP-301' })).text).toBe(
      "Jira is off for this agent's profile.",
    );
    await rights({ jiraProjects: [] });
    expect((await callTool(s, start, 'getJiraIssue', { issueIdOrKey: 'AP-301' })).text).toBe(
      "This agent's profile reaches no Jira project.",
    );
    expect(w.provider.calls).toEqual([]);
  });

  it('addCommentToJiraIssue comments as ADF and is audited as the agent in its turn', async () => {
    answerIssue(w, 'AP-301', 'AP');
    w.provider.route('POST', `${JIRA}/issue/AP-301/comment`, json(201, { id: '900', created: '2026-11-13' }));
    const result = await callTool(s, start, 'addCommentToJiraIssue', {
      issueIdOrKey: 'AP-301',
      commentBody: 'Done.',
    });
    expect(answerOf(result)).toEqual({ commented: 'AP-301', comment: { id: '900', created: '2026-11-13' } });
    expect(w.provider.calls[1]?.body).toMatchObject({ body: { type: 'doc', version: 1 } });
    const agent = await principalOf(w.t.db, s.agentId);
    expect(await toolAudit(w.t.db, 'jira_issue', 'AP-301')).toContainEqual([
      'tool:addCommentToJiraIssue',
      agent,
      start.turnId,
      'comment',
      { id: '900', text: 'Done.' },
    ]);
    const update = await callTool(s, start, 'addCommentToJiraIssue', {
      ...{ issueIdOrKey: 'AP-301' },
      commentBody: 'x',
      commentId: '900',
    });
    expect(update.text).toBe('Updating a comment is not offered: leave out commentId to add a new one.');
  });

  it('transitionJiraIssue moves an issue of the profile’s projects, and refuses fields', async () => {
    answerIssue(w, 'AP-301', 'AP');
    w.provider.route('POST', `${JIRA}/issue/AP-301/transitions`, () => new Response(null, { status: 204 }));
    const result = await callTool(s, start, 'transitionJiraIssue', {
      issueIdOrKey: 'AP-301',
      transition: { id: '31' },
    });
    expect(answerOf(result)).toEqual({ transitioned: 'AP-301', transition: '31' });
    expect(w.provider.calls[1]?.body).toEqual({ transition: { id: '31' } });
    const withFields = { issueIdOrKey: 'AP-301', transition: { id: '31' }, fields: { resolution: null } };
    expect((await callTool(s, start, 'transitionJiraIssue', withFields)).ok).toBe(false);
  });

  it('createJiraIssue creates in a project of the profile’s only, and is audited', async () => {
    w.provider.route('POST', `${JIRA}/issue`, json(201, { id: '10400', key: 'AP-400' }));
    const outside = await callTool(s, start, 'createJiraIssue', {
      projectKey: 'X',
      issueTypeName: 'Task',
      summary: 'N',
    });
    expect(outside.text).toBe(
      "The new issue is in project X, outside the Jira projects this agent's profile reaches (AP).",
    );
    const result = await callTool(s, start, 'createJiraIssue', {
      projectKey: 'ap',
      issueTypeName: 'Task',
      summary: 'New',
      description: 'Body',
      additional_fields: { labels: ['mw'], priority: { name: 'High' } },
    });
    expect(answerOf(result)).toEqual({
      created: { id: '10400', key: 'AP-400', url: 'https://airia.atlassian.net/browse/AP-400' },
    });
    expect(w.provider.calls).toHaveLength(1);
    expect(w.provider.calls[0]?.body).toMatchObject({ fields: { project: { key: 'AP' }, labels: ['mw'] } });
    const fields = (await toolAudit(w.t.db, 'jira_issue', 'AP-400')).map((row) => row[3]);
    expect(fields).toEqual(['project', 'issueType', 'summary']);
    const custom = {
      projectKey: 'AP',
      issueTypeName: 'Task',
      summary: 'N',
      additional_fields: { customfield_1: 'x' },
    };
    expect((await callTool(s, start, 'createJiraIssue', custom)).ok).toBe(false);
  });

  it('editJiraIssue changes summary, description and labels only', async () => {
    answerIssue(w, 'AP-301', 'AP');
    w.provider.route('PUT', `${JIRA}/issue/AP-301`, () => new Response(null, { status: 204 }));
    const result = await callTool(s, start, 'editJiraIssue', {
      issueIdOrKey: 'AP-301',
      fields: { summary: 'Renamed', labels: ['a'] },
    });
    expect(answerOf(result)).toEqual({ edited: 'AP-301', fields: ['summary', 'labels'] });
    expect(w.provider.calls[1]?.body).toEqual({ fields: { summary: 'Renamed', labels: ['a'] } });
    const assignee = await callTool(s, start, 'editJiraIssue', {
      issueIdOrKey: 'AP-301',
      fields: { assignee: null },
    });
    expect(assignee.ok).toBe(false);
  });
});

describe('the sign-in', () => {
  const setStatus = (status: 'active' | 'revoked' | 'needs_sign_in') =>
    rawDb(w.t.db).update(credentials).set({ status }).where(eq(credentials.id, s.signIn.id));

  it('a 401 says to sign in again and marks the sign-in as needing one, as its check would', async () => {
    w.provider.route('GET', `${JIRA}/issue/AP-301`, json(401, { message: 'Client must be authenticated' }));
    const result = await callTool(s, start, 'getJiraIssue', { issueIdOrKey: 'AP-301' });
    expect(result.ok).toBe(false);
    expect(result.text).toContain('needs to sign in again on the Subscriptions page');
    expect(await statusOf(w.t.db, s.signIn.id)).toBe('needs_sign_in');
    await setStatus('active');
  });

  it('a revoked one opens nothing and says so', async () => {
    await setStatus('revoked');
    const result = await callTool(s, start, 'getJiraIssue', { issueIdOrKey: 'AP-301' });
    expect(result.text).toBe(SIGN_IN_REVOKED);
    expect(w.provider.calls).toEqual([]);
    await setStatus('active');
  });
});
