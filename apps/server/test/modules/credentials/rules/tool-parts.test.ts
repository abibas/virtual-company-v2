import { type AtlassianRights, defaultRights } from '@mwc/shared/credentials';
import { describe, expect, it } from 'vitest';
import { type ToolFields, toolColumns } from '../../../../src/modules/credentials/rules/tool-parts.ts';

const PUSH = { repos: ['AiriaLLC/*'], push: true, pullRequests: true };
const WIKI: AtlassianRights = {
  jira: 'read',
  jiraProjects: ['AP'],
  confluence: 'write',
  confluenceSpaces: 'all',
};

const none: ToolFields = {
  githubCredentialId: null,
  githubRights: null,
  atlassianCredentialId: null,
  atlassianRights: null,
};
const withGithub: ToolFields = { ...none, githubCredentialId: 's1', githubRights: PUSH };

describe('toolColumns', () => {
  it('writes nothing for parts left out, or no tools at all', () => {
    expect(toolColumns(undefined, undefined)).toEqual({});
    expect(toolColumns(withGithub, {})).toEqual({});
    expect(toolColumns(withGithub, { github: undefined })).toEqual({});
  });

  it('adds a part with the sign-in and rights given, else none and its tool’s safe rights', () => {
    expect(toolColumns(undefined, { github: { credentialId: 's1', rights: PUSH } })).toEqual({
      githubCredentialId: 's1',
      githubRights: PUSH,
    });
    expect(toolColumns(none, { atlassian: {} })).toEqual({
      atlassianCredentialId: null,
      atlassianRights: defaultRights('atlassian'),
    });
    expect(toolColumns(none, { github: { credentialId: null } })).toEqual({
      githubCredentialId: null,
      githubRights: defaultRights('github'),
    });
  });

  it('changes a part it has: only the sign-in or the rights given', () => {
    expect(toolColumns(withGithub, { github: { credentialId: 's2' } })).toEqual({ githubCredentialId: 's2' });
    expect(toolColumns(withGithub, { github: { credentialId: null } })).toEqual({ githubCredentialId: null });
    const rights = { ...PUSH, push: false };
    expect(toolColumns(withGithub, { github: { rights } })).toEqual({ githubRights: rights });
    expect(toolColumns(withGithub, { github: {} })).toEqual({});
  });

  it('removes a part it has, both columns; removing one it has not writes nothing', () => {
    expect(toolColumns(withGithub, { github: null, atlassian: null })).toEqual({
      githubCredentialId: null,
      githubRights: null,
    });
    expect(toolColumns(undefined, { github: null })).toEqual({});
  });

  it('treats each part on its own', () => {
    expect(
      toolColumns(withGithub, { github: null, atlassian: { credentialId: 's3', rights: WIKI } }),
    ).toEqual({
      githubCredentialId: null,
      githubRights: null,
      atlassianCredentialId: 's3',
      atlassianRights: WIKI,
    });
  });
});
