import type { AccessProfile } from '@mwc/db';
import { type AtlassianRights, defaultRights } from '@mwc/shared/credentials';
import { describe, expect, it } from 'vitest';
import {
  partColumns,
  partInUse,
  removedAiParts,
  runsAfterChange,
  secondAiPart,
} from '../../../../src/modules/credentials/rules/parts.ts';

const PUSH = { repos: ['AiriaLLC/*'], push: true, pullRequests: true };
const WIKI: AtlassianRights = {
  jira: 'read',
  jiraProjects: ['AP'],
  confluence: 'write',
  confluenceSpaces: 'all',
};

const empty = {
  claudePart: false,
  claudeCredentialId: null,
  claudeGatewayCredentialId: null,
  claudeModel: null,
  claudeEffort: null,
  claudeMode: null,
  openaiPart: false,
  openaiCredentialId: null,
  openaiGatewayCredentialId: null,
  openaiModel: null,
  openaiEffort: null,
  openaiMode: null,
  githubCredentialId: null,
  githubRights: null,
  atlassianCredentialId: null,
  atlassianRights: null,
} satisfies Partial<AccessProfile>;
const withClaude = { ...empty, claudePart: true, claudeCredentialId: 'c1', claudeModel: 'claude-opus-5-5' };
const withGithub = { ...empty, githubCredentialId: 's1', githubRights: PUSH };

describe('partColumns', () => {
  it('writes nothing for parts left out, or no parts at all', () => {
    expect(partColumns(undefined, undefined)).toEqual({});
    expect(partColumns(withClaude, {})).toEqual({});
    expect(partColumns(withClaude, { claude: undefined })).toEqual({});
  });

  it('adds an AI part with what it gives, the rest empty and its mode the default (Manual, Ask)', () => {
    expect(partColumns(undefined, { openai: { credentialId: 'o1', effort: 'ultra' } })).toEqual({
      openaiPart: true,
      openaiCredentialId: 'o1',
      openaiGatewayCredentialId: null,
      openaiModel: null,
      openaiEffort: 'ultra',
      openaiMode: 'ask',
    });
    expect(partColumns(empty, { claude: {} })).toMatchObject({ claudePart: true, claudeMode: 'manual' });
    expect(partColumns(empty, { claude: { mode: 'plan' } })).toMatchObject({ claudeMode: 'plan' });
  });

  it('changes an AI part it has: only what it gives', () => {
    expect(partColumns(withClaude, { claude: { model: null, gatewayCredentialId: 'g1' } })).toEqual({
      claudeModel: null,
      claudeGatewayCredentialId: 'g1',
    });
    expect(partColumns(withClaude, { claude: {} })).toEqual({});
    expect(partColumns(withClaude, { claude: { mode: 'bypassPermissions' } })).toEqual({
      claudeMode: 'bypassPermissions',
    });
  });

  it('removes an AI part it has, every column; removing one it has not writes nothing', () => {
    expect(partColumns(withClaude, { claude: null, openai: null })).toEqual({
      claudePart: false,
      claudeCredentialId: null,
      claudeGatewayCredentialId: null,
      claudeModel: null,
      claudeEffort: null,
      claudeMode: null,
    });
  });

  it('adds a tool part with the sign-in and rights given, else none and its tool’s safe rights', () => {
    expect(partColumns(undefined, { github: { credentialId: 's1', rights: PUSH } })).toEqual({
      githubCredentialId: 's1',
      githubRights: PUSH,
    });
    expect(partColumns(empty, { atlassian: {} })).toEqual({
      atlassianCredentialId: null,
      atlassianRights: defaultRights('atlassian'),
    });
  });

  it('changes a tool part it has: only the sign-in or the rights given; removes it with null', () => {
    expect(partColumns(withGithub, { github: { credentialId: 's2' } })).toEqual({ githubCredentialId: 's2' });
    expect(partColumns(withGithub, { github: { rights: { ...PUSH, push: false } } })).toEqual({
      githubRights: { ...PUSH, push: false },
    });
    expect(partColumns(withGithub, { github: {} })).toEqual({});
    expect(partColumns(withGithub, { github: null, atlassian: null })).toEqual({
      githubCredentialId: null,
      githubRights: null,
    });
    expect(partColumns(withGithub, { atlassian: { credentialId: 's3', rights: WIKI } })).toEqual({
      atlassianCredentialId: 's3',
      atlassianRights: WIKI,
    });
  });
});

describe('removedAiParts and runsAfterChange', () => {
  it('names the AI parts a change removes', () => {
    expect(removedAiParts(withClaude, { claudePart: false })).toEqual(['claude']);
    expect(removedAiParts(withClaude, { openaiPart: false })).toEqual([]);
    expect(removedAiParts(withClaude, { claudeModel: null })).toEqual([]);
  });

  it('gives what each AI part runs after a change that sets its model or effort', () => {
    expect(runsAfterChange(withClaude, { claudeEffort: 'max' })).toEqual([
      ['claude', { model: 'claude-opus-5-5', effort: 'max' }],
    ]);
    expect(
      runsAfterChange(undefined, { openaiPart: true, openaiModel: 'gpt-5.5', openaiEffort: null }),
    ).toEqual([['openai', { model: 'gpt-5.5', effort: null }]]);
    expect(runsAfterChange(withClaude, { claudeCredentialId: 'c2' })).toEqual([]);
    expect(runsAfterChange(withClaude, { claudePart: false, claudeModel: null, claudeEffort: null })).toEqual(
      [],
    );
  });
});

describe('partInUse', () => {
  it('names the agents that run on the part', () => {
    expect(partInUse('claude', ['Developer'])).toEqual({
      ok: false,
      status: 422,
      code: 'profile_part_in_use',
      message: "Developer runs on this profile's Claude part: give it another profile first",
    });
    expect(partInUse('openai', ['A', 'B', 'C']).message).toBe(
      "A, B and C run on this profile's OpenAI part: give them another profile first",
    );
  });
});

describe('secondAiPart', () => {
  it('refuses a change that leaves both AI parts, naming the one the profile has', () => {
    expect(secondAiPart(undefined, { claudePart: true, openaiPart: true })).toMatchObject({
      status: 422,
      code: 'one_ai_part',
      message: 'A profile runs one AI: give it a Claude part or an OpenAI part, not both',
    });
    expect(secondAiPart(withClaude, { openaiPart: true })?.message).toBe(
      'This profile already has a Claude part; a profile runs one AI',
    );
    expect(secondAiPart({ ...empty, openaiPart: true }, { claudePart: true })?.message).toBe(
      'This profile already has an OpenAI part; a profile runs one AI',
    );
  });

  it('lets one AI part, none, or a swap through', () => {
    expect(secondAiPart(undefined, { openaiPart: true })).toBeUndefined();
    expect(secondAiPart(withGithub, {})).toBeUndefined();
    expect(secondAiPart(withClaude, { claudePart: false, openaiPart: true })).toBeUndefined();
    expect(secondAiPart(withClaude, { claudeModel: null })).toBeUndefined();
  });
});
