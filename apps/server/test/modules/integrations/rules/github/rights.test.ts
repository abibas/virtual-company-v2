import type { GitHubRights } from '@mwc/shared/credentials';
import { describe, expect, it } from 'vitest';
import {
  fullNameInScope,
  githubRefusal,
  offeredGitHubTools,
  outsideRepos,
  ownerInScope,
  repoInScope,
  splitRepo,
} from '../../../../../src/modules/integrations/rules/github/rights.ts';
import {
  GITHUB_PR_TOOLS,
  GITHUB_READ_TOOLS,
} from '../../../../../src/modules/integrations/schemas/github.ts';

const rights = (changed: Partial<GitHubRights> = {}): GitHubRights => ({
  repos: ['AiriaLLC/*', 'abibas/sandbox'],
  push: false,
  pullRequests: false,
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
