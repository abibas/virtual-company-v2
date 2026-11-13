import { describe, expect, it } from 'vitest';
import { atlassianClient } from '../src/client.ts';
import { COMMENTS_MAX } from '../src/jira.ts';
import { adf, fakeFetch, SIGN_IN } from './fixtures/fetch.ts';

const RAW_ISSUE = {
  id: '10301',
  key: 'AP-301',
  fields: {
    summary: 'Fix the login',
    status: { name: 'In Progress' },
    issuetype: { name: 'Bug' },
    priority: { name: 'High' },
    assignee: { displayName: 'Ihor Herasko' },
    reporter: { displayName: 'QA' },
    created: '2026-11-01T10:00:00.000+0000',
    updated: '2026-11-12T10:00:00.000+0000',
    resolution: null,
    labels: ['auth', 7],
    components: [{ name: 'Web' }],
    project: { key: 'AP' },
    description: adf('The login fails on Safari.'),
    parent: { key: 'AP-300', fields: { summary: 'Auth epic', status: { name: 'Open' } } },
    subtasks: [
      { key: 'AP-302', fields: { summary: 'Write a test', status: { name: 'Done' } } },
      { nokey: 1 },
    ],
    issuelinks: [
      {
        type: { name: 'Blocks', outward: 'blocks', inward: 'is blocked by' },
        outwardIssue: { key: 'AP-310' },
      },
      {
        type: { name: 'Blocks', inward: 'is blocked by' },
        inwardIssue: { key: 'AP-299', fields: { summary: 'Base' } },
      },
      { type: { name: 'Relates' } },
    ],
    comment: {
      total: 12,
      comments: Array.from({ length: 12 }, (_, i) => ({
        id: `c${i + 1}`,
        author: { displayName: 'QA' },
        created: '2026-11-02',
        body: adf(`Comment ${i + 1}`),
      })),
    },
    customfield_10020: [{ name: 'Sprint 7' }],
    customfield_10021: null,
  },
};

describe('Jira through the connector', () => {
  it('searches with JQL by POST, maps each issue, and keeps the next page’s token unless it is the last', async () => {
    const fake = fakeFetch({
      'POST /rest/api/3/search/jql': [
        { body: { issues: [RAW_ISSUE], nextPageToken: 'n-2' } },
        { body: { issues: [], nextPageToken: 'n-3', isLast: true } },
      ],
    });
    const api = atlassianClient({ fetch: fake.fetch });
    const query = {
      jql: 'project in ("AP") AND (assignee = currentUser())',
      fields: ['summary'],
      maxResults: 5,
    };
    const page = await api.searchIssues(SIGN_IN, query);
    expect(fake.calls[0]?.body).toEqual(query);
    expect(page.nextPageToken).toBe('n-2');
    expect(page.issues[0]).toMatchObject({ key: 'AP-301', summary: 'Fix the login', project: 'AP' });
    const last = await api.searchIssues(SIGN_IN, { ...query, nextPageToken: 'n-2' });
    expect(fake.calls[1]?.body).toMatchObject({ nextPageToken: 'n-2' });
    expect(last).toEqual({ issues: [], nextPageToken: null });
  });

  it('reads an issue with the fields asked for, its description and latest comments as Markdown', async () => {
    const fake = fakeFetch({ 'GET /rest/api/3/issue/AP-301': { body: RAW_ISSUE } });
    const issue = await atlassianClient({ fetch: fake.fetch }).getIssue(SIGN_IN, {
      issueIdOrKey: 'AP-301',
      fields: ['summary', 'comment'],
    });
    expect(fake.calls[0]?.url.searchParams.get('fields')).toBe('summary,comment');
    expect(issue).toMatchObject({
      id: '10301',
      url: 'https://acme.atlassian.net/browse/AP-301',
      status: 'In Progress',
      type: 'Bug',
      priority: 'High',
      assignee: 'Ihor Herasko',
      reporter: 'QA',
      resolution: null,
      labels: ['auth'],
      components: ['Web'],
      description: 'The login fails on Safari.',
      parent: { key: 'AP-300', summary: 'Auth epic', status: 'Open' },
      subtasks: [{ key: 'AP-302', summary: 'Write a test', status: 'Done' }],
      links: [
        { relation: 'blocks', key: 'AP-310', summary: null, status: null },
        { relation: 'is blocked by', key: 'AP-299', summary: 'Base', status: null },
      ],
      commentsTotal: 12,
      extra: { customfield_10020: [{ name: 'Sprint 7' }] },
    });
    expect(issue.comments).toHaveLength(COMMENTS_MAX);
    expect(issue.comments.at(-1)).toEqual({
      id: 'c12',
      author: 'QA',
      created: '2026-11-02',
      body: 'Comment 12',
    });
  });

  it('reads an issue of another shape as empty, never failing', async () => {
    const fake = fakeFetch({
      'GET /rest/api/3/issue/X-1': { body: { key: 'X-1', fields: { description: null } } },
    });
    const issue = await atlassianClient({ fetch: fake.fetch }).getIssue(SIGN_IN, {
      issueIdOrKey: 'X-1',
      fields: [],
    });
    expect(issue).toMatchObject({
      key: 'X-1',
      summary: null,
      description: null,
      comments: [],
      commentsTotal: 0,
    });
  });

  it('lists transitions, projects with their issue types, and people', async () => {
    const fake = fakeFetch({
      'GET /rest/api/3/issue/AP-301/transitions': {
        body: { transitions: [{ id: '31', name: 'Done', to: { name: 'Done' } }] },
      },
      'GET /rest/api/3/project/search': {
        body: {
          values: [
            {
              id: '1',
              key: 'AP',
              name: 'Platform',
              projectTypeKey: 'software',
              issueTypes: [{ name: 'Bug' }],
            },
          ],
        },
      },
      'GET /rest/api/3/user/search': {
        body: [
          { accountId: 'u-1', displayName: 'Ihor', emailAddress: 'ihor@example.com' },
          { accountId: 'u-2', active: false },
        ],
      },
    });
    const api = atlassianClient({ fetch: fake.fetch });
    expect(await api.getTransitions(SIGN_IN, 'AP-301')).toEqual([{ id: '31', name: 'Done', to: 'Done' }]);
    expect(await api.searchProjects(SIGN_IN, { query: 'plat', maxResults: 50 })).toEqual([
      { id: '1', key: 'AP', name: 'Platform', type: 'software', issueTypes: ['Bug'] },
    ]);
    expect(fake.calls[1]?.url.search).toBe('?query=plat&maxResults=50&expand=issueTypes');
    expect(await api.findUsers(SIGN_IN, 'ihor')).toEqual([
      { accountId: 'u-1', displayName: 'Ihor', email: 'ihor@example.com', active: true },
      { accountId: 'u-2', displayName: '', email: null, active: false },
    ]);
  });

  it('comments, transitions, creates and edits with ADF bodies, and nothing else', async () => {
    const fake = fakeFetch({
      'POST /rest/api/3/issue/AP-301/comment': {
        status: 201,
        body: { id: '900', created: 'now', body: adf('Done.') },
      },
      'POST /rest/api/3/issue/AP-301/transitions': { status: 204 },
      'POST /rest/api/3/issue': { status: 201, body: { id: '10400', key: 'AP-400' } },
      'PUT /rest/api/3/issue/AP-301': { status: 204 },
    });
    const api = atlassianClient({ fetch: fake.fetch });
    const comment = await api.addComment(SIGN_IN, 'AP-301', { format: 'markdown', text: 'Done.' });
    expect(comment).toEqual({ id: '900', author: null, created: 'now', body: 'Done.' });
    expect(fake.calls[0]?.body).toEqual({ body: adf('Done.') });
    await api.transitionIssue(SIGN_IN, 'AP-301', '31');
    expect(fake.calls[1]?.body).toEqual({ transition: { id: '31' } });
    const created = await api.createIssue(SIGN_IN, {
      projectKey: 'AP',
      issueTypeName: 'Task',
      summary: 'New',
      description: { format: 'markdown', text: 'Body' },
      labels: ['x'],
      priority: 'High',
      components: ['Web'],
      parent: 'AP-300',
      assigneeAccountId: 'u-1',
    });
    expect(created).toEqual({ id: '10400', key: 'AP-400', url: 'https://acme.atlassian.net/browse/AP-400' });
    expect(fake.calls[2]?.body).toEqual({
      fields: {
        project: { key: 'AP' },
        issuetype: { name: 'Task' },
        summary: 'New',
        description: adf('Body'),
        labels: ['x'],
        priority: { name: 'High' },
        components: [{ name: 'Web' }],
        parent: { key: 'AP-300' },
        assignee: { accountId: 'u-1' },
      },
    });
    await api.createIssue(SIGN_IN, { projectKey: 'AP', issueTypeName: 'Task', summary: 'Bare' });
    expect(fake.calls[3]?.body).toEqual({
      fields: { project: { key: 'AP' }, issuetype: { name: 'Task' }, summary: 'Bare' },
    });
    await api.editIssue(SIGN_IN, 'AP-301', { summary: 'Renamed', labels: [] });
    expect(fake.calls[4]?.body).toEqual({ fields: { summary: 'Renamed', labels: [] } });
    await api.editIssue(SIGN_IN, 'AP-301', {
      description: { format: 'adf', text: JSON.stringify(adf('X')) },
    });
    expect(fake.calls[5]?.body).toEqual({ fields: { description: adf('X') } });
  });

  it('keys its paths safely', async () => {
    const fake = fakeFetch({});
    await atlassianClient({ fetch: fake.fetch, retries: 0 })
      .getTransitions(SIGN_IN, 'AP-1/../x')
      .catch(() => undefined);
    expect(fake.calls[0]?.url.pathname).toBe('/rest/api/3/issue/AP-1%2F..%2Fx/transitions');
  });
});
