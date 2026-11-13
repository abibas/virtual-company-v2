import { describe, expect, it } from 'vitest';
import {
  AtlassianRights,
  defaultRights,
  GitHubRights,
  noRights,
  storedRights,
  TOOL_RIGHTS,
  TOOL_SCOPE_MAX,
  ToolRights,
  toolAccountOf,
} from '../../src/credentials/tool-rights.ts';
import { ToolProvider } from '../../src/enums.ts';

const github = (rights: Record<string, unknown> = {}) => ({
  repos: ['AiriaLLC/*'],
  push: true,
  pullRequests: false,
  ...rights,
});
const atlassian = (rights: Record<string, unknown> = {}) => ({
  jira: 'changes',
  jiraProjects: ['AP'],
  confluence: 'write',
  confluenceSpaces: ['ENG'],
  ...rights,
});

describe('GitHub rights', () => {
  it('take all repositories, or owner/name and owner/* without repeats (any case), and push and pull requests', () => {
    expect(GitHubRights.parse(github({ repos: 'all' }))).toEqual(github({ repos: 'all' }));
    const repos = [' AiriaLLC/airia-platform ', 'AiriaLLC/*', 'airiallc/AIRIA-platform', 'me/dot.files_2-x'];
    expect(GitHubRights.parse(github({ repos })).repos).toEqual([
      'AiriaLLC/airia-platform',
      'AiriaLLC/*',
      'me/dot.files_2-x',
    ]);
    expect(GitHubRights.parse(github({ repos: [] })).repos).toEqual([]);
  });

  it.each([
    'AiriaLLC',
    '*/*',
    'AiriaLLC/',
    '/repo',
    '-owner/repo',
    'owner/..',
    'owner/.',
    'owner/a b',
    'o/w/n',
    `${'o'.repeat(40)}/repo`,
  ])('refuse the repository %j', (repo) => {
    expect(GitHubRights.safeParse(github({ repos: [repo] })).success).toBe(false);
  });

  it('refuse more than the most repositories, a missing right, and anything else (merge is no option)', () => {
    const many = Array.from({ length: TOOL_SCOPE_MAX + 1 }, (_, i) => `o/r${i}`);
    expect(GitHubRights.safeParse(github({ repos: many })).success).toBe(false);
    expect(GitHubRights.safeParse({ repos: 'all', push: true }).success).toBe(false);
    expect(GitHubRights.safeParse(github({ merge: true })).success).toBe(false);
    expect(GitHubRights.safeParse(github({ repos: 'some' })).success).toBe(false);
  });
});

describe('Atlassian rights', () => {
  it('take Jira off, read or changes and Confluence off, read or write, with all or keys, without repeats', () => {
    expect(AtlassianRights.parse(atlassian({ jiraProjects: 'all', confluenceSpaces: 'all' }))).toEqual(
      atlassian({ jiraProjects: 'all', confluenceSpaces: 'all' }),
    );
    const parsed = AtlassianRights.parse(
      atlassian({ jiraProjects: [' ap ', 'AP', 'SS_2'], confluenceSpaces: ['ENG', '~557058:ab-12', 'eng'] }),
    );
    expect(parsed.jiraProjects).toEqual(['AP', 'SS_2']);
    expect(parsed.confluenceSpaces).toEqual(['ENG', '~557058:ab-12', 'eng']);
    for (const jira of ['off', 'read', 'changes']) {
      expect(AtlassianRights.safeParse(atlassian({ jira })).success).toBe(true);
    }
  });

  it('refuse other levels, bad keys and anything else (delete is no option)', () => {
    expect(AtlassianRights.safeParse(atlassian({ jira: 'write' })).success).toBe(false);
    expect(AtlassianRights.safeParse(atlassian({ confluence: 'changes' })).success).toBe(false);
    expect(AtlassianRights.safeParse(atlassian({ jiraProjects: ['2AP'] })).success).toBe(false);
    expect(AtlassianRights.safeParse(atlassian({ jiraProjects: ['A-P'] })).success).toBe(false);
    expect(AtlassianRights.safeParse(atlassian({ confluenceSpaces: ['E N G'] })).success).toBe(false);
    expect(AtlassianRights.safeParse(atlassian({ delete: true })).success).toBe(false);
  });
});

describe('a tool part’s rights', () => {
  it('are either tool’s, told apart by their keys, never a mix', () => {
    expect('repos' in ToolRights.parse(github())).toBe(true);
    expect('jira' in ToolRights.parse(atlassian())).toBe(true);
    expect(ToolRights.safeParse({ ...github(), jira: 'read' }).success).toBe(false);
    expect(Object.keys(TOOL_RIGHTS)).toEqual(ToolProvider.options);
  });

  it('start at the safe end: GitHub reaches nothing and only reads, Atlassian only reads', () => {
    expect(defaultRights('github')).toEqual({ repos: [], push: false, pullRequests: false });
    expect(defaultRights('atlassian')).toEqual({
      jira: 'read',
      jiraProjects: 'all',
      confluence: 'read',
      confluenceSpaces: 'all',
    });
    for (const provider of ToolProvider.options) {
      expect(TOOL_RIGHTS[provider].parse(defaultRights(provider))).toEqual(defaultRights(provider));
    }
  });

  it('read back as stored, or as no rights at all when they do not parse as the tool’s', () => {
    expect(storedRights('github', github())).toEqual(github());
    expect(storedRights('atlassian', atlassian())).toEqual(atlassian());
    expect(storedRights('github', atlassian())).toEqual(noRights('github'));
    expect(storedRights('atlassian', null)).toEqual({
      jira: 'off',
      jiraProjects: [],
      confluence: 'off',
      confluenceSpaces: [],
    });
  });
});

describe('toolAccountOf', () => {
  it('names a GitHub sign-in by its login, an Atlassian one by its name (else its email) and site', () => {
    expect(toolAccountOf('github_oauth', 'ihor@example.com', { login: 'ihorherasko', name: 'Ihor' })).toEqual(
      {
        account: 'ihorherasko',
        site: null,
      },
    );
    expect(toolAccountOf('github_token', null, {})).toEqual({ account: null, site: null });
    const meta = { site: 'airia.atlassian.net', displayName: 'Ihor Herasko' };
    expect(toolAccountOf('atlassian_api_token', 'ihor@example.com', meta)).toEqual({
      account: 'Ihor Herasko',
      site: 'airia.atlassian.net',
    });
    expect(toolAccountOf('atlassian_api_token', 'ihor@example.com', { displayName: ' ' })).toEqual({
      account: 'ihor@example.com',
      site: null,
    });
    expect(toolAccountOf('claude_oauth', 'ihor@example.com', { login: 'x' })).toEqual({
      account: null,
      site: null,
    });
  });
});
