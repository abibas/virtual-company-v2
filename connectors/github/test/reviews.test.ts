import { GitHubError } from '@mwc/tools-core';
import { describe, expect, it } from 'vitest';
import { githubClient } from '../src/client.ts';
import { fakeFetch, REPO, SIGN_IN } from './fixtures/fetch.ts';

const REVIEWS = '/repos/acme/web/pulls/7/reviews';
const rawReview = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  node_id: `PRR_${id}`,
  user: { login: 'reviewer' },
  state: 'APPROVED',
  body: 'LGTM',
  html_url: `https://github.com/acme/web/pull/7#pullrequestreview-${id}`,
  ...extra,
});

describe('pull request reviews through the connector', () => {
  it('reads the account the sign-in acts as, and refuses an answer without a login', async () => {
    const fake = fakeFetch({ 'GET /user': [{ body: { login: 'ihorherasko' } }, { body: {} }] });
    const api = githubClient({ fetch: fake.fetch });
    expect(await api.viewerLogin(SIGN_IN)).toBe('ihorherasko');
    await expect(api.viewerLogin(SIGN_IN)).rejects.toBeInstanceOf(GitHubError);
  });

  it('makes a review with its event, body, commit and line comments in REST’s names, mapped back', async () => {
    const fake = fakeFetch({ [`POST ${REVIEWS}`]: { body: rawReview(9) } });
    const review = await githubClient({ fetch: fake.fetch }).createReview(SIGN_IN, REPO, 7, {
      event: 'APPROVE',
      body: 'LGTM',
      commitId: 'abc',
      comments: [
        { path: 'a.ts', body: 'Nit', line: 4 },
        { path: 'b.ts', body: 'Range', line: 9, side: 'RIGHT', startLine: 5, startSide: 'LEFT' },
      ],
    });
    expect(fake.calls[0]?.body).toEqual({
      event: 'APPROVE',
      body: 'LGTM',
      commit_id: 'abc',
      comments: [
        { path: 'a.ts', body: 'Nit', line: 4 },
        { path: 'b.ts', body: 'Range', line: 9, side: 'RIGHT', start_line: 5, start_side: 'LEFT' },
      ],
    });
    expect(review).toMatchObject({
      id: 9,
      nodeId: 'PRR_9',
      state: 'APPROVED',
      url: expect.stringContaining('9'),
    });
  });

  it('leaves a review pending without an event, and submits and deletes a pending one', async () => {
    const fake = fakeFetch({
      [`POST ${REVIEWS}`]: { body: rawReview(3, { state: 'PENDING' }) },
      [`POST ${REVIEWS}/3/events`]: { body: rawReview(3, { state: 'COMMENTED' }) },
      [`DELETE ${REVIEWS}/3`]: { body: rawReview(3, { state: 'PENDING' }) },
    });
    const api = githubClient({ fetch: fake.fetch });
    expect((await api.createReview(SIGN_IN, REPO, 7, {})).state).toBe('PENDING');
    expect(fake.calls[0]?.body).toEqual({});
    const submitted = await api.submitReview(SIGN_IN, REPO, 7, 3, { event: 'COMMENT', body: 'Notes' });
    expect(fake.calls[1]?.body).toEqual({ event: 'COMMENT', body: 'Notes' });
    expect(submitted.state).toBe('COMMENTED');
    expect((await api.deletePendingReview(SIGN_IN, REPO, 7, 3)).id).toBe(3);
    expect(fake.calls[2]?.method).toBe('DELETE');
  });

  it('adds a comment to a pending review through GraphQL, and says GraphQL’s refusal in its words', async () => {
    const thread = { id: 'PRRT_1', comments: { nodes: [{ url: 'https://github.com/c/1' }] } };
    const fake = fakeFetch({
      'POST /graphql': [
        { body: { data: { addPullRequestReviewThread: { thread } } } },
        { body: { errors: [{ message: 'Line could not be resolved' }] } },
        { body: { data: {} } },
      ],
    });
    const api = githubClient({ fetch: fake.fetch });
    const comment = { path: 'a.ts', body: 'Why?', subjectType: 'LINE', line: 4, side: 'RIGHT' } as const;
    expect(await api.addPendingReviewComment(SIGN_IN, 'PRR_3', comment)).toEqual({
      id: 'PRRT_1',
      url: 'https://github.com/c/1',
    });
    const sent = fake.calls[0]?.body as { query: string; variables: { input: unknown } };
    expect(sent.query).toContain('addPullRequestReviewThread');
    expect(sent.variables.input).toEqual({ pullRequestReviewId: 'PRR_3', ...comment });
    await expect(api.addPendingReviewComment(SIGN_IN, 'PRR_3', comment)).rejects.toThrow(
      'Line could not be resolved',
    );
    await expect(api.addPendingReviewComment(SIGN_IN, 'PRR_3', comment)).rejects.toBeInstanceOf(GitHubError);
  });
});
