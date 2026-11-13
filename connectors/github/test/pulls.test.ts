import { describe, expect, it } from 'vitest';
import { githubClient } from '../src/client.ts';
import { fakeFetch, REPO, rawPull, SIGN_IN } from './fixtures/fetch.ts';

const PAGE = { page: 2, perPage: 10 };
const PULLS = '/repos/acme/web/pulls';

describe('pull requests through the connector', () => {
  it('lists a repository’s with its filters and page, mapped', async () => {
    const fake = fakeFetch({ [`GET ${PULLS}`]: { body: [rawPull(7), 'odd'] } });
    const list = await githubClient({ fetch: fake.fetch }).listPullRequests(SIGN_IN, REPO, {
      state: 'all',
      base: 'main',
      sort: 'updated',
      direction: 'desc',
      ...PAGE,
    });
    expect(fake.calls[0]?.url.search).toBe(
      '?state=all&base=main&sort=updated&direction=desc&page=2&per_page=10',
    );
    expect(list[0]).toEqual({
      number: 7,
      title: 'Pull 7',
      state: 'open',
      draft: false,
      merged: false,
      url: 'https://github.com/acme/web/pull/7',
      repository: 'acme/web',
      author: 'ihor',
      head: 'feature-7',
      base: 'main',
      labels: ['bug'],
      createdAt: '2026-11-10T10:00:00Z',
      updatedAt: '2026-11-12T10:00:00Z',
    });
    expect(list[1]).toMatchObject({ number: 0, title: '', author: null, repository: '' });
  });

  it('reads one whole, its diff as text, and its files, commits, reviews and comments by page', async () => {
    const fake = fakeFetch({
      [`GET ${PULLS}/7`]: [
        { body: rawPull(7, { mergeable: true, commits: 3, requested_reviewers: [{ login: 'qa' }] }) },
        { text: 'diff --git a/a b/a' },
      ],
      [`GET ${PULLS}/7/files`]: {
        body: [{ filename: 'a.ts', status: 'modified', additions: 2, patch: '@@' }],
      },
      [`GET ${PULLS}/7/commits`]: {
        body: [{ sha: 'c1', commit: { message: 'Fix', author: { name: 'Ihor', date: '2026-11-11' } } }],
      },
      [`GET ${PULLS}/7/reviews`]: { body: [{ id: 1, user: { login: 'qa' }, state: 'APPROVED', body: '' }] },
      [`GET ${PULLS}/7/comments`]: {
        body: [
          { id: 2, user: { login: 'qa' }, body: 'Nit', path: 'a.ts', original_line: 4, in_reply_to_id: 1 },
        ],
      },
    });
    const api = githubClient({ fetch: fake.fetch });
    const pull = await api.getPullRequest(SIGN_IN, REPO, 7);
    expect(pull).toMatchObject({
      nodeId: 'PR_node7',
      headSha: 'sha7',
      headRepository: 'acme/web',
      mergeable: true,
      commits: 3,
      body: 'Fixes the login.',
      requestedReviewers: ['qa'],
      mergedAt: null,
    });
    expect(await api.getPullRequestDiff(SIGN_IN, REPO, 7)).toBe('diff --git a/a b/a');
    expect(fake.calls[1]?.headers.accept).toBe('application/vnd.github.diff');
    expect(await api.listPullRequestFiles(SIGN_IN, REPO, 7, PAGE)).toEqual([
      {
        filename: 'a.ts',
        status: 'modified',
        additions: 2,
        deletions: 0,
        patch: '@@',
        previousFilename: null,
      },
    ]);
    expect(fake.calls[2]?.url.search).toBe('?page=2&per_page=10');
    expect((await api.listPullRequestCommits(SIGN_IN, REPO, 7, PAGE))[0]).toMatchObject({
      sha: 'c1',
      message: 'Fix',
      author: 'Ihor',
      date: '2026-11-11',
      files: [],
    });
    expect((await api.listReviews(SIGN_IN, REPO, 7, PAGE))[0]).toMatchObject({
      author: 'qa',
      state: 'APPROVED',
    });
    expect((await api.listReviewComments(SIGN_IN, REPO, 7, PAGE))[0]).toMatchObject({
      body: 'Nit',
      path: 'a.ts',
      line: 4,
      inReplyTo: 1,
    });
  });

  it('reads a head commit’s combined status and its check runs', async () => {
    const fake = fakeFetch({
      'GET /repos/acme/web/commits/sha7/status': {
        body: { state: 'failure', statuses: [{ context: 'ci', state: 'failure', target_url: 'https://ci' }] },
      },
      'GET /repos/acme/web/commits/sha7/check-runs': {
        body: { check_runs: [{ name: 'test', status: 'completed', conclusion: 'success' }] },
      },
    });
    const api = githubClient({ fetch: fake.fetch });
    expect(await api.getCombinedStatus(SIGN_IN, REPO, 'sha7')).toEqual({
      state: 'failure',
      statuses: [{ context: 'ci', state: 'failure', description: null, url: 'https://ci' }],
    });
    expect(await api.listCheckRuns(SIGN_IN, REPO, 'sha7', PAGE)).toEqual([
      { name: 'test', status: 'completed', conclusion: 'success', url: null, completedAt: null },
    ]);
  });

  it('opens one with only what was given, and changes only its title, body and base', async () => {
    const fake = fakeFetch({
      [`POST ${PULLS}`]: { status: 201, body: rawPull(8) },
      [`PATCH ${PULLS}/8`]: { body: rawPull(8) },
    });
    const api = githubClient({ fetch: fake.fetch });
    const made = await api.createPullRequest(SIGN_IN, REPO, {
      title: 'Add login',
      head: 'feature-8',
      base: 'main',
      draft: true,
      maintainerCanModify: false,
    });
    expect(made.number).toBe(8);
    expect(fake.calls[0]?.body).toEqual({
      title: 'Add login',
      head: 'feature-8',
      base: 'main',
      draft: true,
      maintainer_can_modify: false,
    });
    await api.createPullRequest(SIGN_IN, REPO, { title: 't', head: 'h', base: 'b', body: 'B' });
    expect(fake.calls[1]?.body).toEqual({ title: 't', head: 'h', base: 'b', body: 'B' });
    await api.updatePullRequest(SIGN_IN, REPO, 8, { title: 'New', base: 'dev' });
    expect(fake.calls[2]).toMatchObject({ method: 'PATCH', body: { title: 'New', base: 'dev' } });
    await api.updatePullRequest(SIGN_IN, REPO, 8, { body: 'Text' });
    expect(fake.calls[3]?.body).toEqual({ body: 'Text' });
  });

  it('turns a draft ready or back through GraphQL, and reads GraphQL’s errors as a refusal', async () => {
    const fake = fakeFetch({
      'POST /graphql': [
        { body: { data: {} } },
        { body: { data: {} } },
        { body: { errors: [{ message: 'Pull request is not a draft' }, {}] } },
      ],
    });
    const api = githubClient({ fetch: fake.fetch });
    await api.setDraft(SIGN_IN, 'PR_node8', true);
    expect(fake.calls[0]?.body).toMatchObject({ variables: { id: 'PR_node8' } });
    expect(JSON.stringify(fake.calls[0]?.body)).toContain('convertPullRequestToDraft');
    await api.setDraft(SIGN_IN, 'PR_node8', false);
    expect(JSON.stringify(fake.calls[1]?.body)).toContain('markPullRequestReadyForReview');
    await expect(api.setDraft(SIGN_IN, 'PR_node8', false)).rejects.toMatchObject({
      code: 'bad_request',
      message: 'GitHub refused the request as written. Pull request is not a draft',
    });
  });

  it('requests reviewers', async () => {
    const fake = fakeFetch({ [`POST ${PULLS}/8/requested_reviewers`]: { status: 201, body: rawPull(8) } });
    await githubClient({ fetch: fake.fetch }).requestReviewers(SIGN_IN, REPO, 8, [
      'copilot-pull-request-reviewer[bot]',
    ]);
    expect(fake.calls[0]?.body).toEqual({ reviewers: ['copilot-pull-request-reviewer[bot]'] });
  });
});
