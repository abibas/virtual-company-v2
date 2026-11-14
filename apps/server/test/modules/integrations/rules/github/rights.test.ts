import type { GitHubRights } from '@mwc/shared/credentials';
import { describe, expect, it } from 'vitest';
import {
  fullNameInScope,
  githubRefusal,
  judgesPull,
  offeredGitHubTools,
  outsideRepos,
  ownerInScope,
  ownPullWords,
  REVIEWS_OFF,
  repoInScope,
  reviewEventRefusal,
  splitRepo,
} from '../../../../../src/modules/integrations/rules/github/rights.ts';
import {
  GITHUB_PR_TOOLS,
  GITHUB_READ_TOOLS,
  GITHUB_REVIEW_TOOLS,
} from '../../../../../src/modules/integrations/schemas/github.ts';

const rights = (changed: Partial<GitHubRights> = {}): GitHubRights => ({
  repos: ['AiriaLLC/*', 'abibas/sandbox'],
  push: false,
  pullRequests: false,
  reviews: 'off',
  ...changed,
});

describe('the GitHub tools a part gives', () => {
  it('reads wherever it reaches, opens and updates pull requests only with pullRequests, nothing reaching none', () => {
    expect(offeredGitHubTools(rights())).toEqual([...GITHUB_READ_TOOLS]);
    expect(offeredGitHubTools(rights({ pullRequests: true, repos: 'all' }))).toEqual([
      ...GITHUB_READ_TOOLS,
      ...GITHUB_PR_TOOLS,
    ]);
    expect(offeredGitHubTools(rights({ repos: [], pullRequests: true }))).toEqual([]);
  });

  it('refuses each call the rights do not give, in words', () => {
    expect(githubRefusal('get_commit', rights())).toBeUndefined();
    expect(githubRefusal('create_pull_request', rights())).toBe(
      "Pull requests are off for this agent's profile: it may only read.",
    );
    expect(githubRefusal('create_pull_request', rights({ pullRequests: true }))).toBeUndefined();
    expect(githubRefusal('list_branches', rights({ repos: [] }))).toBe(
      "This agent's profile reaches no GitHub repository.",
    );
  });
});

describe('the review tools a part gives (its reviews right)', () => {
  it('gives the review tools with comment or approve, with or without pull requests, never reaching none', () => {
    expect(offeredGitHubTools(rights({ reviews: 'comment' }))).toEqual([
      ...GITHUB_READ_TOOLS,
      ...GITHUB_REVIEW_TOOLS,
    ]);
    expect(offeredGitHubTools(rights({ reviews: 'approve', pullRequests: true }))).toEqual([
      ...GITHUB_READ_TOOLS,
      ...GITHUB_PR_TOOLS,
      ...GITHUB_REVIEW_TOOLS,
    ]);
    expect(offeredGitHubTools(rights({ reviews: 'approve', repos: [] }))).toEqual([]);
  });

  it('refuses the review tools with reviews off, whatever pullRequests says', () => {
    for (const tool of GITHUB_REVIEW_TOOLS) {
      expect(githubRefusal(tool, rights({ pullRequests: true }))).toBe(REVIEWS_OFF);
      expect(githubRefusal(tool, rights({ reviews: 'comment' }))).toBeUndefined();
    }
  });

  it.each([
    ['comment', undefined, true],
    ['comment', 'COMMENT', true],
    ['comment', 'APPROVE', false],
    ['comment', 'REQUEST_CHANGES', false],
    ['approve', undefined, true],
    ['approve', 'COMMENT', true],
    ['approve', 'APPROVE', true],
    ['approve', 'REQUEST_CHANGES', true],
  ] as const)('reviews %s gives the event %s: %s', (reviews, event, given) => {
    const refusal = reviewEventRefusal(event, rights({ reviews }));
    if (given) expect(refusal).toBeUndefined();
    else
      expect(refusal).toBe(
        `${event} is off for this agent's profile: it may only comment in reviews (COMMENT, a pending review, line comments).`,
      );
  });

  it('knows the events an account never gives its own pull request', () => {
    expect([undefined, 'COMMENT', 'APPROVE', 'REQUEST_CHANGES'].map(judgesPull)).toEqual([
      false,
      false,
      true,
      true,
    ]);
    expect(ownPullWords('a/b#1', 'me', 'APPROVE')).toContain("a/b#1 is me's own pull request");
  });
});

describe('the repositories allowlist', () => {
  it('holds owner/name and owner/*, ignoring case, and everything for all', () => {
    const { repos } = rights();
    expect(repoInScope(repos, 'airiallc', 'airia-platform')).toBe(true);
    expect(repoInScope(repos, 'Abibas', 'Sandbox')).toBe(true);
    expect(repoInScope(repos, 'abibas', 'other')).toBe(false);
    expect(repoInScope('all', 'any', 'thing')).toBe(true);
    expect(ownerInScope(repos, 'AIRIALLC')).toBe(true);
    expect(ownerInScope(repos, 'abibas')).toBe(false);
    expect(fullNameInScope(repos, 'AiriaLLC/web')).toBe(true);
    expect(fullNameInScope(repos, 'nope')).toBe(false);
    expect(splitRepo('a/b/c')).toBeUndefined();
    expect(splitRepo('a/b')).toEqual({ owner: 'a', name: 'b' });
    expect(outsideRepos('x/y', ['a/*', 'b/c'])).toBe(
      "x/y is outside the GitHub repositories this agent's profile reaches (a/*, b/c).",
    );
  });
});
