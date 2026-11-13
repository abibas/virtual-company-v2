import type { GitHubRights } from '@mwc/shared/credentials';
import type { TurnStart } from '@mwc/shared/runner-protocol';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type ChatsWorld, chatsWorld } from '../../../../fixtures/chats/world.ts';
import { json } from '../../../../fixtures/credentials/providers.ts';
import {
  API,
  answerOf,
  callTool,
  type GitHubScene,
  githubScene,
  githubTurn,
  PUSH_PRS,
  putGitHubPart,
  REPOS,
  rawHit,
  statusOf,
} from '../../../../fixtures/integrations/github.ts';

/**
 * The GitHub read tools besides pull requests' own, through a live turn (S7.1d): searches kept to the profile's
 * repositories and their results filtered, an issue by method, commits, a file and branches; and a 401 marking the
 * sign-in. One turn serves every test; the part is changed between calls.
 */

let w: ChatsWorld;
let s: GitHubScene;
let start: TurnStart;
const REPO = 'AiriaLLC/airia-platform';
const AT = { owner: 'AiriaLLC', repo: 'airia-platform' };

const rights = (changed: Partial<GitHubRights>) =>
  putGitHubPart(w.t.db, s.profile.id, { credentialId: s.signIn.id, rights: { ...PUSH_PRS, ...changed } });

beforeAll(async () => {
  w = await chatsWorld();
});
let made: Promise<void> | undefined;
beforeEach(async () => {
  made ??= (async () => {
    s = await githubScene(w);
    start = await githubTurn(w, s);
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

const sentQuery = () => new URL(w.provider.calls.at(-1)?.url ?? 'http://x').searchParams;

describe('the searches', () => {
  it('search_pull_requests: “my latest PR in a repository”, scoped, newest first, results outside dropped', async () => {
    w.provider.route(
      'GET',
      `${API}/search/issues`,
      json(200, { total_count: 2, items: [rawHit(REPO, 41), rawHit('evil/other', 7)] }),
    );
    const result = await callTool(s, start, 'search_pull_requests', {
      query: 'author:@me',
      ...AT,
      sort: 'updated',
      order: 'desc',
      perPage: 1,
    });
    expect(answerOf(result)).toMatchObject({
      query: 'author:@me repo:AiriaLLC/airia-platform is:pr',
      total: 2,
    });
    expect((answerOf(result).items as { number: number }[]).map((item) => item.number)).toEqual([41]);
    expect(sentQuery().get('sort')).toBe('updated');
    expect(sentQuery().get('per_page')).toBe('1');
  });

  it('search_issues gets the allowlist and is:issue; a scope outside it is refused before GitHub hears of it', async () => {
    w.provider.route(
      'GET',
      `${API}/search/issues`,
      json(200, { total_count: 0, items: [], incomplete_results: true }),
    );
    const result = await callTool(s, start, 'search_issues', { query: 'label:bug' });
    expect(answerOf(result)).toEqual({
      query: 'label:bug user:AiriaLLC repo:abibas/sandbox is:issue',
      total: 0,
      incomplete: true,
      items: [],
    });
    w.provider.reset();
    const outside = await callTool(s, start, 'search_issues', { query: 'repo:evil/other label:bug' });
    expect(outside).toMatchObject({ ok: false, text: expect.stringContaining('evil/other is outside') });
    expect(w.provider.calls).toEqual([]);
  });

  it('search_repositories, kept to the allowlist, its results filtered', async () => {
    w.provider.route(
      'GET',
      `${API}/search/repositories`,
      json(200, { total_count: 2, items: [{ full_name: REPO }, { full_name: 'evil/other' }] }),
    );
    const result = await callTool(s, start, 'search_repositories', {
      query: 'platform',
      minimal_output: true,
    });
    expect(answerOf(result)).toMatchObject({ query: 'platform user:AiriaLLC repo:abibas/sandbox', total: 2 });
    expect((answerOf(result).items as { fullName: string }[]).map((item) => item.fullName)).toEqual([REPO]);
    w.provider.reset();
    const refused = await callTool(s, start, 'search_repositories', { query: 'user:abibas' });
    expect(refused.ok).toBe(false);
  });
});

describe('issues, commits, files and branches', () => {
  const issues = `${REPOS}/${REPO}/issues`;

  it('issue_read: an issue whole, its comments, sub-issues and labels', async () => {
    w.provider.route(
      'GET',
      `${issues}/7`,
      json(200, { ...rawHit(REPO, 7, false), labels: [{ name: 'bug' }] }),
    );
    const read = (method: string) => callTool(s, start, 'issue_read', { ...AT, method, issue_number: 7 });
    expect(answerOf(await read('get'))).toMatchObject({ number: 7, isPullRequest: false, repository: REPO });
    expect(answerOf(await read('get_labels'))).toEqual({ labels: ['bug'] });
    w.provider.route('GET', `${issues}/7/comments`, json(200, [{ id: 1, body: 'Seen.' }]));
    expect(JSON.parse((await read('get_comments')).text)).toEqual([{ id: 1, body: 'Seen.' }]);
    w.provider.route('GET', `${issues}/7/sub_issues`, json(200, [rawHit(REPO, 8, false)]));
    expect(JSON.parse((await read('get_sub_issues')).text)[0]).toMatchObject({ number: 8 });
  });

  it('list_commits and get_commit, with or without its files', async () => {
    const commits = `${REPOS}/${REPO}/commits`;
    w.provider.route('GET', commits, json(200, [{ sha: 'c1', commit: { message: 'One' } }]));
    const list = await callTool(s, start, 'list_commits', { ...AT, sha: 'dev', author: 'ihor-fake' });
    expect(JSON.parse(list.text)).toEqual([{ sha: 'c1', message: 'One' }]);
    expect(sentQuery().get('sha')).toBe('dev');
    const one = { sha: 'c2', commit: { message: 'Two' }, files: [{ filename: 'a.ts', status: 'added' }] };
    w.provider.route('GET', `${commits}/c2`, json(200, one));
    expect(answerOf(await callTool(s, start, 'get_commit', { ...AT, sha: 'c2' }))).toMatchObject({
      files: [{ filename: 'a.ts' }],
    });
    expect(
      answerOf(await callTool(s, start, 'get_commit', { ...AT, sha: 'c2', detail: 'none' })),
    ).not.toHaveProperty('files');
  });

  it('get_file_contents at a commit before a ref, and list_branches', async () => {
    const content = Buffer.from('# Airia\n').toString('base64');
    const file = { type: 'file', path: 'README.md', sha: 'f1', size: 8, content, encoding: 'base64' };
    w.provider.route('GET', `${REPOS}/${REPO}/contents/README.md`, json(200, file));
    const result = await callTool(s, start, 'get_file_contents', {
      ...AT,
      path: 'README.md',
      ref: 'dev',
      sha: 'c9',
    });
    expect(answerOf(result)).toMatchObject({ kind: 'file', text: '# Airia\n' });
    expect(sentQuery().get('ref')).toBe('c9');
    w.provider.route(
      'GET',
      `${REPOS}/${REPO}/branches`,
      json(200, [{ name: 'main', commit: { sha: 'c9' } }]),
    );
    expect(JSON.parse((await callTool(s, start, 'list_branches', AT)).text)).toEqual([
      { name: 'main', sha: 'c9', protected: false },
    ]);
  });

  it('a 401 says to sign in again and marks the sign-in as needing one', async () => {
    w.provider.route('GET', `${REPOS}/${REPO}/branches`, json(401, { message: 'Bad credentials' }));
    const result = await callTool(s, start, 'list_branches', AT);
    expect(result.text).toContain('needs to sign in again');
    expect(await statusOf(w.t.db, s.signIn.id)).toBe('needs_sign_in');
  });
});
