import type { AtlassianRights } from '@mwc/shared/credentials';
import { describe, expect, it } from 'vitest';
import { partsRefusal } from '../../../../src/modules/credentials/rules/tool-profiles.ts';

const GITHUB = { repos: ['AiriaLLC/*'], push: true, pullRequests: false };
const ATLASSIAN: AtlassianRights = {
  jira: 'read',
  jiraProjects: 'all',
  confluence: 'write',
  confluenceSpaces: ['ENG'],
};

describe('partsRefusal', () => {
  it('lets a tool profile take its own tool’s rights, and nulls of what it has not', () => {
    expect(partsRefusal('github', { rights: GITHUB })).toBeUndefined();
    expect(partsRefusal('atlassian', { rights: ATLASSIAN })).toBeUndefined();
    expect(partsRefusal('github', { gatewayCredentialId: null, model: null, effort: null })).toBeUndefined();
    expect(partsRefusal('github', {})).toBeUndefined();
  });

  it.each([
    ['a gateway', { gatewayCredentialId: 'g1' }],
    ['a model', { model: 'claude-opus-5-5' }],
    ['an effort', { effort: 'high' as const }],
  ])('refuses a tool profile %s', (_, choice) => {
    expect(partsRefusal('atlassian', choice)).toEqual({
      ok: false,
      status: 422,
      code: 'not_for_tool_profile',
      message:
        'An Atlassian profile has no gateway, model or effort: it holds an Atlassian sign-in and its rights',
    });
  });

  it('refuses the other tool’s rights', () => {
    expect(partsRefusal('github', { rights: ATLASSIAN })).toMatchObject({
      status: 422,
      code: 'rights_provider_mismatch',
      message: "A GitHub profile takes GitHub's rights, not Atlassian's",
    });
    expect(partsRefusal('atlassian', { rights: GITHUB })?.code).toBe('rights_provider_mismatch');
  });

  it('refuses rights on an AI profile, which takes its gateway, model and effort', () => {
    expect(partsRefusal('claude', { rights: GITHUB })).toMatchObject({
      status: 422,
      code: 'rights_not_for_ai_profile',
      message: 'A Claude profile has no rights: only GitHub and Atlassian profiles do',
    });
    expect(
      partsRefusal('openai', { gatewayCredentialId: 'g1', model: 'gpt-6.1-sol', effort: 'ultra' }),
    ).toBeUndefined();
  });
});
