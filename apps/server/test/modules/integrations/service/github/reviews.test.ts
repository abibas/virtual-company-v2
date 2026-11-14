import type { GitHubRights } from '@mwc/shared/credentials';
import type { TurnStart } from '@mwc/shared/runner-protocol';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type ChatsWorld, chatsWorld, usesOf } from '../../../../fixtures/chats/world.ts';
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
  toolAudit,
} from '../../../../fixtures/integrations/github.ts';

/**
 * The review tools through a live turn (2026-11-14): each event against each `reviews` right, the account's own pull
 * request, the repositories allowlist, line comments, and the pending review's comment, submit and delete; each change
 * audited as the agent. One turn serves every test; the part's rights change between calls, as each call reads them.
 */

let w: ChatsWorld;
let s: GitHubScene;
let start: TurnStart;
const REPO = 'AiriaLLC/airia-platform';
const PULLS = `${REPOS}/${REPO}/pulls`;
const REVIEWS = `${PULLS}/41/reviews`;
const AT = { owner: 'AiriaLLC', repo: 'airia-platform', pullNumber: 41 };
/** The pull requests' author in the fixtures (`rawPull`). */
const AUTHOR = 'ihor-fake';
const ME = 'code-reviewer';

const rights = (changed: Partial<GitHubRights>) =>
  putGitHubPart(w.t.db, s.profile.id, { credentialId: s.signIn.id, rights: { ...PUSH_PRS, ...changed } });

const rawReview = (id: number, state: string, extra: Record<string, unknown> = {}) => ({
  id,
  node_id: `PRR_${id}`,
  user: { login: ME },
  state,
  body: '',
  html_url: `https://github.com/${REPO}/pull/41#pullrequestreview-${id}`,
  ...extra,
});

/** GitHub as the review tools find it: the sign-in's login, the pull request, and a new review answered. */
function github(login = ME, made = rawReview(9, 'APPROVED')) {
  w.provider.route('GET', `${API}/user`, json(200, { login }));
  w.provider.route('GET', `${PULLS}/41`, json(200, rawPull(REPO, 41)));
  w.provider.route('POST', REVIEWS, json(200, made));
}

const review = (input: Record<string, unknown>) =>
  callTool(s, start, 'pull_request_review_write', { ...AT, method: 'create', ...input });

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

describe('a review’s event against the reviews right', () => {
  it.each([
    ['off', 'COMMENT', false],
    ['off', 'APPROVE', false],
    ['off', 'REQUEST_CHANGES', false],
    ['comment', 'COMMENT', true],
    ['comment', 'APPROVE', false],
    ['comment', 'REQUEST_CHANGES', false],
    ['approve', 'COMMENT', true],
    ['approve', 'APPROVE', true],
    ['approve', 'REQUEST_CHANGES', true],
  ] as const)('reviews %s, event %s: given %s', async (reviews, event, given) => {
    await rights({ reviews });
    github();
    const result = await review({ event, body: 'Looks right.' });
    expect(result.ok).toBe(given);
    const posted = w.provider.calls.filter((call) => call.method === 'POST');
    if (!given) {
      expect(posted).toEqual([]);
      expect(result.text).toContain(reviews === 'off' ? 'Reviews are off' : `${event} is off`);
      return;
    }
    expect(posted[0]?.body).toEqual({ event, body: 'Looks right.' });
    expect(answerOf(result)).toMatchObject({
      pullRequest: `${REPO}#41`,
      review: { id: 9, url: `https://github.com/${REPO}/pull/41#pullrequestreview-9` },
    });
  });
});

describe('what a review never does', () => {
  it('never approves or requests changes on the account’s own pull request, but comments on it', async () => {
    await rights({ reviews: 'approve' });
    github(AUTHOR.toUpperCase());
    for (const event of ['APPROVE', 'REQUEST_CHANGES']) {
      const result = await review({ event, body: 'Mine.' });
      expect(result).toMatchObject({
        ok: false,
        text: expect.stringContaining(`${REPO}#41 is ${AUTHOR.toUpperCase()}'s own pull request`),
      });
    }
    expect(w.provider.calls.filter((call) => call.method === 'POST')).toEqual([]);
    expect((await review({ event: 'COMMENT', body: 'A note.' })).ok).toBe(true);
  });

  it('refuses a repository outside the profile’s and resolving threads, asking nothing of GitHub', async () => {
    await rights({ reviews: 'approve' });
    const outside = await review({ owner: 'abibas', repo: 'private', event: 'APPROVE' });
    expect(outside.text).toContain('abibas/private is outside');
    const thread = await review({ threadId: 'PRRT_1' });
    expect(thread.text).toContain('Resolving review threads is not offered');
    const submit = await review({ method: 'submit_pending' });
    expect(submit.text).toContain('submit_pending needs an event');
    expect(w.provider.calls).toEqual([]);
  });
});

describe('line comments and pending reviews', () => {
  it('makes a review with line comments, audited as the agent with the review’s address', async () => {
    await rights({ reviews: 'comment' });
    github(ME, rawReview(10, 'COMMENTED'));
    const comments = [
      { path: 'src/a.ts', line: 12, body: 'Null here?' },
      { path: 'src/b.ts', startLine: 3, line: 8, side: 'RIGHT', body: 'Split this.' },
    ];
    const result = await review({ event: 'COMMENT', body: 'Two notes.', comments });
    expect(answerOf(result)).toMatchObject({ comments: 2, review: { id: 10, state: 'COMMENTED' } });
    expect(w.provider.calls.at(-1)?.body).toEqual({
      event: 'COMMENT',
      body: 'Two notes.',
      comments: [
        { path: 'src/a.ts', line: 12, body: 'Null here?' },
        { path: 'src/b.ts', start_line: 3, line: 8, side: 'RIGHT', body: 'Split this.' },
      ],
    });
    const agent = await principalOf(w.t.db, s.agentId);
    const rows = await toolAudit(w.t.db, 'github_pull_request', `${REPO}#41`);
    expect(rows.slice(-3)).toEqual([
      ['tool:pull_request_review_write', agent, start.turnId, 'review', '10: COMMENT'],
      ['tool:pull_request_review_write', agent, start.turnId, 'body', 'Two notes.'],
      ['tool:pull_request_review_write', agent, start.turnId, 'comments', 2],
    ]);
    expect((await usesOf(w.t.db, s.signIn.id)).at(-1)?.purpose).toBe('tool:pull_request_review_write');
    const range = await review({ comments: [{ path: 'a', startLine: 9, line: 3, body: 'x' }] });
    expect(range.text).toContain('startLine needs line, and comes before it');
  });

  it('leaves one pending, adds a comment to it, submits it, and refuses APPROVE with comment only', async () => {
    await rights({ reviews: 'comment' });
    github(ME, rawReview(11, 'PENDING'));
    const pending = await review({});
    expect(answerOf(pending)).toMatchObject({ review: { id: 11, state: 'PENDING' }, note: expect.any(String) });
    expect(w.provider.calls.at(-1)?.body).toEqual({});
    const others = rawReview(5, 'PENDING', { user: { login: 'someone' } });
    w.provider.route('GET', REVIEWS, json(200, [others, rawReview(11, 'PENDING')]));
    const thread = { id: 'PRRT_7', comments: { nodes: [{ url: 'https://github.com/c/7' }] } };
    w.provider.route('POST', `${API}/graphql`, json(200, { data: { addPullRequestReviewThread: { thread } } }));
    const comment = await callTool(s, start, 'add_comment_to_pending_review', {
      ...AT,
      path: 'src/a.ts',
      body: 'Why?',
      subjectType: 'LINE',
      line: 4,
    });
    expect(answerOf(comment)).toMatchObject({ comment: 'https://github.com/c/7', review: { id: 11 } });
    expect(w.provider.calls.at(-1)?.body).toMatchObject({
      variables: { input: { pullRequestReviewId: 'PRR_11', path: 'src/a.ts', subjectType: 'LINE', line: 4 } },
    });
    const approve = await callTool(s, start, 'pull_request_review_write', {
      ...AT,
      method: 'submit_pending',
      event: 'APPROVE',
    });
    expect(approve.text).toContain('APPROVE is off');
    w.provider.route('POST', `${REVIEWS}/11/events`, json(200, rawReview(11, 'COMMENTED')));
    const submitted = await callTool(s, start, 'pull_request_review_write', {
      ...AT,
      method: 'submit_pending',
      event: 'COMMENT',
      body: 'Done.',
    });
    expect(answerOf(submitted)).toMatchObject({ review: { id: 11, state: 'COMMENTED' } });
    expect(w.provider.calls.at(-1)?.body).toEqual({ event: 'COMMENT', body: 'Done.' });
    const rows = await toolAudit(w.t.db, 'github_pull_request', `${REPO}#41`);
    expect(rows.slice(-3).map(([action, , , field, value]) => [action, field, value])).toEqual([
      ['tool:add_comment_to_pending_review', 'comment', '11 src/a.ts:4: Why?'],
      ['tool:pull_request_review_write', 'review', '11: COMMENT'],
      ['tool:pull_request_review_write', 'body', 'Done.'],
    ]);
  });

  it('deletes only the account’s own pending review, and says when there is none', async () => {
    await rights({ reviews: 'comment' });
    github();
    w.provider.route('GET', REVIEWS, json(200, [rawReview(5, 'PENDING', { user: { login: 'someone' } })]));
    const none = await callTool(s, start, 'pull_request_review_write', { ...AT, method: 'delete_pending' });
    expect(none).toMatchObject({ ok: false, text: expect.stringContaining(`${ME} has no pending review`) });
    const comment = { ...AT, path: 'a.ts', body: 'x', subjectType: 'FILE' };
    expect((await callTool(s, start, 'add_comment_to_pending_review', comment)).ok).toBe(false);
    w.provider.reset();
    github();
    w.provider.route('GET', REVIEWS, json(200, [rawReview(12, 'PENDING')]));
    w.provider.route('DELETE', `${REVIEWS}/12`, json(200, rawReview(12, 'PENDING')));
    const deleted = await callTool(s, start, 'pull_request_review_write', { ...AT, method: 'delete_pending' });
    expect(answerOf(deleted)).toMatchObject({ deleted: { id: 12, state: 'PENDING' } });
    expect(w.provider.calls.at(-1)?.method).toBe('DELETE');
    const rows = await toolAudit(w.t.db, 'github_pull_request', `${REPO}#41`);
    expect(rows.at(-1)?.slice(3)).toEqual(['review', 'deleted']);
  });
});
