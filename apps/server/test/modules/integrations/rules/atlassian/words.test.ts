import { ServerToolDefs } from '@mwc/shared/harness';
import { describe, expect, it } from 'vitest';
import { atlassianLine, toolDef } from '../../../../../src/modules/integrations/rules/atlassian/words.ts';
import { AtlassianTool } from '../../../../../src/modules/integrations/schemas/atlassian.ts';

describe('the Atlassian tools’ words', () => {
  it('defines every tool for a turn’s spec: its words, its input schema, read-only or not', () => {
    const defs = AtlassianTool.options.map(toolDef);
    expect(ServerToolDefs.parse(defs)).toHaveLength(15);
    expect(toolDef('getJiraIssue')).toBe(toolDef('getJiraIssue'));
    const create = toolDef('createJiraIssue');
    expect(create).toMatchObject({ readOnly: false, title: 'Create a Jira issue' });
    expect(create.inputSchema).toMatchObject({ required: ['projectKey', 'issueTypeName', 'summary'] });
    expect(create.inputSchema).not.toHaveProperty('$schema');
    expect(toolDef('searchConfluenceUsingCql').readOnly).toBe(true);
  });

  it('says in one line what the agent may do, where, as whom and with which tools', () => {
    const line = atlassianLine(
      { site: 'airia.atlassian.net', account: 'Ihor\nHerasko' },
      { jira: 'changes', jiraProjects: 'all', confluence: 'off', confluenceSpaces: [] },
      ['getJiraIssue', 'addCommentToJiraIssue'],
    );
    expect(line).toBe(
      'Atlassian tools (from Most Wanted): on airia.atlassian.net as Ihor Herasko, Jira: read, comment on, ' +
        'transition, create and edit issues in every project; Confluence: off. Your tools, by the names of ' +
        "Atlassian's remote MCP: getJiraIssue, addCommentToJiraIssue; cloudId is not needed; they never delete or " +
        'archive.',
    );
    expect(line.includes('\n')).toBe(false);
    const unnamed = atlassianLine(
      { site: null, account: null },
      { jira: 'off', jiraProjects: [], confluence: 'write', confluenceSpaces: ['ENG', 'OPS'] },
      ['createConfluencePage'],
    );
    expect(unnamed).toContain(
      'on your Atlassian site, Jira: off; Confluence: read, create and update pages in ENG, OPS.',
    );
  });
});
