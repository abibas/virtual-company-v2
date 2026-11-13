import { describe, expect, it } from 'vitest';
import { githubClient } from '../src/client.ts';
import { contentsOf, repositoryOfUrl, textOf } from '../src/map.ts';
import { contentsPath } from '../src/repos.ts';
import { fakeFetch, REPO, SIGN_IN } from './fixtures/fetch.ts';

const PAGE = { page: 1, perPage: 30 };
const ISSUES = '/repos/acme/web/issues';

const rawIssue = (number: number, extra: Record<string, unknown> = {}) => ({
  number,
  title: `Issue ${number}`,
  state: 'open',
  html_url: `https://github.com/acme/web/issues/${number}`,
  repository_url: 'https://api.github.com/repos/acme/web',
  user: { login: 'ihor' },
  labels: [{ name: 'bug' }, 'plain'],
  comments: 2,
  body: 'It breaks.',
  ...extra,
});

describe('searches through the connector', () => {
  it('searches issues and pull requests with the query, sort and page, and reads each hit’s repository', async () => {
    const fake = fakeFetch({
      'GET /search/issues': {
        body: { total_count: 41, incomplete_results: true, items: [rawIssue(3, { pull_request: {} })] },
      },
    });
    const page = await githubClient({ fetch: fake.fetch }).searchIssues(SIGN_IN, {
      q: 'is:pr author:@me repo:acme/web',
      sort: 'updated',
      order: 'desc',
      ...PAGE,
    });
    expect(fake.calls[0]?.url.searchParams.get('q')).toBe('is:pr author:@me repo:acme/web');
    expect(fake.calls[0]?.url.searchParams.get('sort')).toBe('updated');
    expect(page.total).toBe(41);
    expect(page.incomplete).toBe(true);
    expect(page.items[0]).toMatchObject({
      number: 3,
      isPullRequest: true,
      repository: 'acme/web',
      labels: ['bug', 'plain'],
      author: 'ihor',
    });
  });

  it('searches repositories, and reads an odd answer as empty', async () => {
    const fake = fakeFetch({
      'GET /search/repositories': [
        {
          body: {
            total_count: 1,
            items: [
              {
                full_name: 'acme/web',
                private: true,
                default_branch: 'main',
                html_url: 'https://g/acme/web',
              },
            ],
          },
        },
        { body: 'odd' },
      ],
    });
    const api = githubClient({ fetch: fake.fetch });
    const page = await api.searchRepositories(SIGN_IN, { q: 'web user:acme', ...PAGE });
    expect(page).toEqual({
      total: 1,
      incomplete: false,
      items: [
        {
          fullName: 'acme/web',
          description: null,
          private: true,
          archived: false,
          defaultBranch: 'main',
          url: 'https://g/acme/web',
          language: null,
          updatedAt: null,
        },
      ],
    });
    expect(await api.searchRepositories(SIGN_IN, { q: 'x', ...PAGE })).toEqual({
      total: 0,
      incomplete: false,
      items: [],
    });
  });
});

describe('issues through the connector', () => {
  it('reads one with its people, comments and sub-issues, and adds a comment', async () => {
    const fake = fakeFetch({
      [`GET ${ISSUES}/3`]: {
        body: rawIssue(3, { assignees: [{ login: 'qa' }], milestone: { title: 'v1' }, state_reason: null }),
      },
      [`GET ${ISSUES}/3/comments`]: {
        body: [{ id: 9, user: { login: 'qa' }, body: 'Seen.', html_url: 'https://c' }],
      },
      [`GET ${ISSUES}/3/sub_issues`]: { body: [rawIssue(4)] },
      [`POST ${ISSUES}/3/comments`]: {
        status: 201,
        body: { id: 10, user: { login: 'ihor' }, body: 'Done.' },
      },
    });
    const api = githubClient({ fetch: fake.fetch });
    expect(await api.getIssue(SIGN_IN, REPO, 3)).toMatchObject({
      number: 3,
      isPullRequest: false,
      assignees: ['qa'],
      milestone: 'v1',
      stateReason: null,
      body: 'It breaks.',
    });
    expect(await api.listIssueComments(SIGN_IN, REPO, 3, PAGE)).toEqual([
      { id: 9, author: 'qa', body: 'Seen.', createdAt: null, url: 'https://c' },
    ]);
    expect((await api.listSubIssues(SIGN_IN, REPO, 3, PAGE))[0]?.number).toBe(4);
    expect(await api.addIssueComment(SIGN_IN, REPO, 3, 'Done.')).toMatchObject({ id: 10, body: 'Done.' });
    expect(fake.calls[3]?.body).toEqual({ body: 'Done.' });
  });
});

describe('repositories through the connector', () => {
  it('lists commits by their filters and reads one with its files', async () => {
    const fake = fakeFetch({
      'GET /repos/acme/web/commits': {
        body: [{ sha: 'c1', author: { login: 'ihor' }, commit: { message: 'One', author: { name: 'I' } } }],
      },
      'GET /repos/acme/web/commits/main': {
        body: {
          sha: 'c2',
          commit: { message: 'Two' },
          files: [{ filename: 'b.ts', status: 'added', additions: 1 }],
        },
      },
    });
    const api = githubClient({ fetch: fake.fetch });
    const commits = await api.listCommits(SIGN_IN, REPO, {
      sha: 'dev',
      author: 'ihor',
      since: '2026-11-01',
      ...PAGE,
    });
    expect(fake.calls[0]?.url.search).toBe('?sha=dev&author=ihor&since=2026-11-01&page=1&per_page=30');
    expect(commits[0]).toMatchObject({ sha: 'c1', author: 'ihor', message: 'One' });
    const commit = await api.getCommit(SIGN_IN, REPO, 'main', PAGE);
    expect(commit.files).toEqual([
      { filename: 'b.ts', status: 'added', additions: 1, deletions: 0, patch: null, previousFilename: null },
    ]);
  });

  it('reads a file as text, a folder as its entries, and lists branches', async () => {
    const text = Buffer.from('export const a = 1;\n').toString('base64');
    const fake = fakeFetch({
      'GET /repos/acme/web/contents/src/a.ts': {
        body: { type: 'file', path: 'src/a.ts', sha: 's1', size: 20, content: text, encoding: 'base64' },
      },
      'GET /repos/acme/web/contents/src': {
        body: [{ name: 'a.ts', type: 'file', size: 20 }, { name: 'lib' }],
      },
      'GET /repos/acme/web/branches': { body: [{ name: 'main', commit: { sha: 'c9' }, protected: true }] },
    });
    const api = githubClient({ fetch: fake.fetch });
    expect(await api.getContents(SIGN_IN, REPO, { path: 'src/a.ts', ref: 'dev' })).toEqual({
      kind: 'file',
      path: 'src/a.ts',
      sha: 's1',
      size: 20,
      text: 'export const a = 1;\n',
    });
    expect(fake.calls[0]?.url.search).toBe('?ref=dev');
    expect(await api.getContents(SIGN_IN, REPO, { path: '/src/' })).toEqual({
      kind: 'dir',
      path: '/src/',
      entries: [
        { name: 'a.ts', type: 'file', size: 20 },
        { name: 'lib', type: '', size: 0 },
      ],
    });
    expect(await api.listBranches(SIGN_IN, REPO, PAGE)).toEqual([
      { name: 'main', sha: 'c9', protected: true },
    ]);
  });
});

describe('the mapping helpers', () => {
  it('read a repository from its API address, text only when it is text, and odd contents as a file', () => {
    expect(repositoryOfUrl('https://api.github.com/repos/acme/web')).toBe('acme/web');
    expect(repositoryOfUrl(7)).toBe('');
    expect(textOf(Buffer.from([0x61, 0x00]).toString('base64'), 'base64')).toBeNull();
    expect(textOf(Buffer.from([0xff, 0xfe, 0x41]).toString('base64'), 'base64')).toBeNull();
    expect(textOf('', 'none')).toBeNull();
    expect(contentsOf({ type: 'symlink', target: 'x' }, 'link')).toEqual({
      kind: 'file',
      path: 'link',
      sha: '',
      size: 0,
      text: null,
    });
    expect(contentsPath(REPO, 'docs/a b.md')).toBe('/repos/acme/web/contents/docs/a%20b.md');
    expect(contentsPath(REPO, '')).toBe('/repos/acme/web/contents/');
  });
});
