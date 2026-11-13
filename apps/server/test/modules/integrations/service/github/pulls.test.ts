import type { GitHubRights } from '@mwc/shared/credentials';
import type { TurnStart } from '@mwc/shared/runner-protocol';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { COPILOT_REVIEWER } from '../../../../../src/modules/integrations/service/github/pulls.ts';
import { type ChatsWorld, chatsWorld, turnRow, usesOf } from '../../../../fixtures/chats/world.ts';
import { json } from '../../../../fixtures/credentials/providers.ts';
import {
  API,
  answerOf,
  callTool,
  type GitHubScene,
  githubScene,
  githubTurn,
  PUSH_PRS,
  principalOf,
  putGitHubPart,
  REPOS,
  rawPull,
  TOKEN,
  toolAudit,
} from '../../../../fixtures/integrations/github.ts';

/**
 * The pull request tools through a live turn (S7.1d): the runner relays each call, the server checks the profile's rights
 * and repositories, calls the fake GitHub with the sealed sign-in, records the use and audits each change as the agent.
 * One turn serves every test; the profile's part is changed between calls, since each call reads it again.
 */

let w: ChatsWorld;
let s: GitHubScene;
let start: TurnStart;
const REPO = 'AiriaLLC/airia-platform';
const PULLS = `${REPOS}/${REPO}/pulls`;
const AT = { owner: 'AiriaLLC', repo: 'airia-platform' };

const rights = (changed: Partial<GitHubRights>) =>
  putGitHubPart(w.t.db, s.profile.id, { credentialId: s.signIn.id, rights: { ...PUSH_PRS, ...changed } });

beforeAll(async () => {
  w = await chatsWorld();
});
/** The scene and its turn, made by the first test that needs them (a hook's 10 s are short on a loaded machine). */
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

describe('list_pull_requests', () => {
  it('lists a repository’s with the sealed token, GitHub’s headers and the filters, and records the use', async () => {
    w.provider.route('GET', PULLS, json(200, [rawPull(REPO, 41), rawPull(REPO, 40)]));
    const result = await callTool(s, start, 'list_pull_requests', {
      ...AT,
      state: 'all',
      sort: 'updated',
      direction: 'desc',
      perPage: 1,
    });
    expect(result.ok).toBe(true);
    const listed = JSON.parse(result.text) as { number: number; head: string }[];
    expect(listed.map((pull) => pull.number)).toEqual([41, 40]);
    const [sent] = w.provider.calls;
    expect(sent?.url).toBe(`${PULLS}?state=all&sort=updated&direction=desc&page=1&per_page=1`);
    expect(sent?.headers).toMatchObject({
      authorization: `Bearer ${TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    });
    expect(result.text).not.toContain('GHLOGINtoken');
    const use = (await usesOf(w.t.db, s.signIn.id)).at(-1);
    const turn = await turnRow(w.t.db, start.turnId);
    expect(use).toMatchObject({
      purpose: 'tool:list_pull_requests',
      companyId: s.company.companyId,
      agentId: s.agentId,
      chatId: s.chat.id,
      principalId: turn?.createdBy,
    });
  });

  it('refuses a repository outside the profile’s, asking nothing of GitHub', async () => {
    const result = await callTool(s, start, 'list_pull_requests', { owner: 'abibas', repo: 'private' });
    expect(result).toMatchObject({ ok: false, text: expect.stringContaining('abibas/private is outside') });
    expect(w.provider.calls).toEqual([]);
  });
});

describe('pull_request_read', () => {
  const read = (method: string) => callTool(s, start, 'pull_request_read', { ...AT, method, pullNumber: 41 });

  it('reads one, its diff, files, commits, reviews and both kinds of comments', async () => {
    w.provider.route('GET', `${PULLS}/41`, json(200, rawPull(REPO, 41)));
    expect(answerOf(await read('get'))).toMatchObject({ number: 41, headSha: 'sha41', body: 'About 41.' });
    w.provider.route('GET', `${PULLS}/41`, () => new Response('diff --git a/x b/x\n'));
    expect(answerOf(await read('get_diff'))).toEqual({ diff: 'diff --git a/x b/x\n' });
    expect(w.provider.calls.at(-1)?.headers.accept).toBe('application/vnd.github.diff');
    w.provider.route(
      'GET',
      `${PULLS}/41/files`,
      json(200, [{ filename: 'a.ts', status: 'added', additions: 3 }]),
    );
    expect(JSON.parse((await read('get_files')).text)).toEqual([
      { filename: 'a.ts', status: 'added', additions: 3, deletions: 0 },
    ]);
    w.provider.route('GET', `${PULLS}/41/commits`, json(200, [{ sha: 'c1', commit: { message: 'Fix' } }]));
    expect(JSON.parse((await read('get_commits')).text)).toEqual([{ sha: 'c1', message: 'Fix' }]);
    w.provider.route('GET', `${PULLS}/41/reviews`, json(200, [{ id: 1, state: 'APPROVED', body: '' }]));
    expect(JSON.parse((await read('get_reviews')).text)).toEqual([{ id: 1, state: 'APPROVED' }]);
    w.provider.route(
      'GET',
      `${PULLS}/41/comments`,
      json(200, [{ id: 2, body: 'Nit', path: 'a.ts', line: 3 }]),
    );
    expect(JSON.parse((await read('get_review_comments')).text)).toEqual([
      { id: 2, body: 'Nit', path: 'a.ts', line: 3 },
    ]);
    w.provider.route('GET', `${REPOS}/${REPO}/issues/41/comments`, json(200, [{ id: 3, body: 'LGTM' }]));
    expect(JSON.parse((await read('get_comments')).text)).toEqual([{ id: 3, body: 'LGTM' }]);
  });

  it('reads the head commit’s status and check runs', async () => {
    w.provider.route('GET', `${PULLS}/41`, json(200, rawPull(REPO, 41)));
    w.provider.route(
      'GET',
      `${REPOS}/${REPO}/commits/sha41/status`,
      json(200, { state: 'success', statuses: [] }),
    );
    expect(answerOf(await read('get_status'))).toEqual({ headSha: 'sha41', state: 'success', statuses: [] });
    w.provider.route(
      'GET',
      `${REPOS}/${REPO}/commits/sha41/check-runs`,
      json(200, { check_runs: [{ name: 'ci', status: 'completed', conclusion: 'failure' }] }),
    );
    expect(answerOf(await read('get_check_runs'))).toMatchObject({
      headSha: 'sha41',
      checkRuns: [{ name: 'ci', conclusion: 'failure' }],
    });
  });
});

describe('the pull request changes', () => {
  it('opens one from a pushed branch, audited as the agent on the pull request', async () => {
    w.provider.route('POST', PULLS, json(201, rawPull(REPO, 42, { draft: true })));
    const result = await callTool(s, start, 'create_pull_request', {
      ...AT,
      title: 'Fix the login',
      head: 'fix-login',
      base: 'main',
      body: 'Closes AP-301.',
      draft: true,
    });
    expect(answerOf(result)).toMatchObject({ number: 42, draft: true });
    expect(w.provider.calls[0]?.body).toEqual({
      title: 'Fix the login',
      head: 'fix-login',
      base: 'main',
      body: 'Closes AP-301.',
      draft: true,
    });
    const agent = await principalOf(w.t.db, s.agentId);
    expect(await toolAudit(w.t.db, 'github_pull_request', `${REPO}#42`)).toEqual([
      ['tool:create_pull_request', agent, start.turnId, 'title', 'Fix the login'],
      ['tool:create_pull_request', agent, start.turnId, 'head', 'fix-login'],
      ['tool:create_pull_request', agent, start.turnId, 'base', 'main'],
      ['tool:create_pull_request', agent, start.turnId, 'draft', true],
      ['tool:create_pull_request', agent, start.turnId, 'body', 'Closes AP-301.'],
    ]);
  });

  it('changes the title and makes it ready for review through GraphQL, audited with what was', async () => {
    w.provider.route('GET', `${PULLS}/43`, json(200, rawPull(REPO, 43, { draft: true })));
    w.provider.route('PATCH', `${PULLS}/43`, json(200, rawPull(REPO, 43, { draft: true, title: 'New' })));
    w.provider.route('POST', `${API}/graphql`, json(200, { data: {} }));
    const result = await callTool(s, start, 'update_pull_request', {
      ...AT,
      pullNumber: 43,
      title: 'New',
      draft: false,
    });
    expect(answerOf(result)).toMatchObject({ title: 'New', draft: false });
    expect(w.provider.calls.map((call) => call.method)).toEqual(['GET', 'PATCH', 'POST']);
    expect(w.provider.calls[1]?.body).toEqual({ title: 'New' });
    expect(w.provider.calls[2]?.body).toMatchObject({ variables: { id: 'PR_43' } });
    const rows = await toolAudit(w.t.db, 'github_pull_request', `${REPO}#43`);
    expect(rows.map(([, , , field, value]) => [field, value])).toEqual([
      ['title', 'New'],
      ['draft', false],
    ]);
  });

  it('asks nothing more when the draft state is already so, and changes nothing without a field', async () => {
    w.provider.route('GET', `${PULLS}/44`, json(200, rawPull(REPO, 44)));
    const result = await callTool(s, start, 'update_pull_request', { ...AT, pullNumber: 44, draft: false });
    expect(result.ok).toBe(true);
    expect(w.provider.calls.map((call) => call.method)).toEqual(['GET']);
    expect(await toolAudit(w.t.db, 'github_pull_request', `${REPO}#44`)).toEqual([]);
  });

  it('comments on a pull request, refuses an issue, and asks Copilot to review', async () => {
    const issues = `${REPOS}/${REPO}/issues`;
    w.provider.route('GET', `${issues}/45`, json(200, { number: 45, pull_request: {} }));
    w.provider.route('POST', `${issues}/45/comments`, json(201, { id: 9, body: 'Ready.' }));
    const comment = await callTool(s, start, 'add_issue_comment', {
      ...AT,
      issue_number: 45,
      body: 'Ready.',
    });
    expect(answerOf(comment)).toEqual({ id: 9, body: 'Ready.' });
    w.provider.route('GET', `${issues}/46`, json(200, { number: 46 }));
    const onIssue = await callTool(s, start, 'add_issue_comment', { ...AT, issue_number: 46, body: 'x' });
    expect(onIssue.text).toBe(
      `${REPO}#46 is an issue, not a pull request: comments go on pull requests only.`,
    );
    w.provider.route('POST', `${PULLS}/45/requested_reviewers`, json(201, rawPull(REPO, 45)));
    const review = await callTool(s, start, 'request_copilot_review', { ...AT, pullNumber: 45 });
    expect(answerOf(review)).toEqual({ requested: 'Copilot', pullRequest: `${REPO}#45` });
    expect(w.provider.calls.at(-1)?.body).toEqual({ reviewers: [COPILOT_REVIEWER] });
    const rows = await toolAudit(w.t.db, 'github_pull_request', `${REPO}#45`);
    expect(rows.map(([action, , , field, value]) => [action, field, value])).toEqual([
      ['tool:add_issue_comment', 'comment', '9: Ready.'],
      ['tool:request_copilot_review', 'reviewer', COPILOT_REVIEWER],
    ]);
  });

  it('refuses every change once pull requests are off for the profile', async () => {
    await rights({ pullRequests: false });
    const result = await callTool(s, start, 'create_pull_request', {
      ...AT,
      title: 't',
      head: 'h',
      base: 'main',
    });
    expect(result).toMatchObject({
      ok: false,
      text: "Pull requests are off for this agent's profile: it may only read.",
    });
    expect(w.provider.calls).toEqual([]);
  });
});
