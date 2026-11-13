import type { AtlassianRights } from '@mwc/shared/credentials';
import { describe, expect, it } from 'vitest';
import {
  inScope,
  isWriteTool,
  offeredTools,
  outsideProjects,
  outsideSpaces,
  toolRefusal,
} from '../../../../../src/modules/integrations/rules/atlassian/rights.ts';
import {
  AtlassianTool,
  CONFLUENCE_READ_TOOLS,
  CONFLUENCE_WRITE_TOOLS,
  JIRA_CHANGE_TOOLS,
  JIRA_READ_TOOLS,
} from '../../../../../src/modules/integrations/schemas/atlassian.ts';

const rights = (r: Partial<AtlassianRights>): AtlassianRights => ({
  jira: 'off',
  jiraProjects: 'all',
  confluence: 'off',
  confluenceSpaces: 'all',
  ...r,
});

describe('the tools a profile’s Atlassian part gives', () => {
  it('reads with read, adds changes and writes with those, none for off', () => {
    expect(offeredTools(rights({}))).toEqual([]);
    expect(offeredTools(rights({ jira: 'read' }))).toEqual([...JIRA_READ_TOOLS]);
    expect(offeredTools(rights({ jira: 'changes' }))).toEqual([...JIRA_READ_TOOLS, ...JIRA_CHANGE_TOOLS]);
    expect(offeredTools(rights({ confluence: 'read' }))).toEqual([...CONFLUENCE_READ_TOOLS]);
    expect(offeredTools(rights({ jira: 'read', confluence: 'write' }))).toEqual([
      ...JIRA_READ_TOOLS,
      ...CONFLUENCE_READ_TOOLS,
      ...CONFLUENCE_WRITE_TOOLS,
    ]);
  });

  it('gives a product with no project or space chosen nothing', () => {
    expect(
      offeredTools(rights({ jira: 'changes', jiraProjects: [], confluence: 'write', confluenceSpaces: [] })),
    ).toEqual([]);
  });

  it('refuses each call the rights do not give, in words', () => {
    const cases: [AtlassianTool, Partial<AtlassianRights>, string | undefined][] = [
      ['getJiraIssue', { jira: 'read' }, undefined],
      ['getJiraIssue', {}, "Jira is off for this agent's profile."],
      [
        'addCommentToJiraIssue',
        { jira: 'read' },
        "Jira changes are off for this agent's profile: it may only read.",
      ],
      ['editJiraIssue', { jira: 'changes' }, undefined],
      ['getJiraIssue', { jira: 'read', jiraProjects: [] }, "This agent's profile reaches no Jira project."],
      ['getConfluencePage', {}, "Confluence is off for this agent's profile."],
      ['getConfluencePage', { confluence: 'read' }, undefined],
      [
        'updateConfluencePage',
        { confluence: 'read' },
        "Confluence writing is off for this agent's profile: it may only read.",
      ],
      ['createConfluencePage', { confluence: 'write' }, undefined],
      [
        'searchConfluenceUsingCql',
        { confluence: 'write', confluenceSpaces: [] },
        "This agent's profile reaches no Confluence space.",
      ],
    ];
    for (const [tool, given, refusal] of cases) expect(toolRefusal(tool, rights(given))).toBe(refusal);
  });

  it('tells the writes and the scope, and says what is outside it', () => {
    expect(AtlassianTool.options.filter(isWriteTool)).toEqual([
      ...JIRA_CHANGE_TOOLS,
      ...CONFLUENCE_WRITE_TOOLS,
    ]);
    expect(inScope('all', null)).toBe(true);
    expect(inScope(['AP'], 'AP')).toBe(true);
    expect(inScope(['AP'], null)).toBe(false);
    expect(outsideProjects('AP-1', null, ['AP', 'SS'])).toBe(
      "AP-1 is in no project, outside the Jira projects this agent's profile reaches (AP, SS).",
    );
    expect(outsideSpaces('Page 1', null, ['ENG'])).toBe(
      "Page 1 is in no space, outside the Confluence spaces this agent's profile reaches (ENG).",
    );
  });
});
