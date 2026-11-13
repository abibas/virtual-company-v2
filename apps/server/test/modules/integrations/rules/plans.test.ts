import { describe, expect, it } from 'vitest';
import { joinLabels, mergePlans } from '../../../../src/modules/integrations/rules/plans.ts';

const tool = (name: string) => ({ name, title: name, description: name, inputSchema: {}, readOnly: true });
const GITHUB = { token: 'ghp_x', repos: 'all' as const };

describe('the server tools’ plans merged', () => {
  it('puts the tools one after the other, the lines one under the other and the labels in one sentence', () => {
    const merged = mergePlans([
      { tools: [tool('getJiraIssue')], instructions: 'Atlassian line.', label: 'Jira and Confluence' },
      {
        tools: [tool('list_branches')],
        instructions: 'GitHub line.',
        label: 'GitHub',
        github: GITHUB,
        pushLabel: 'git push',
      },
    ]);
    expect(merged).toEqual({
      tools: [tool('getJiraIssue'), tool('list_branches')],
      instructions: 'Atlassian line.\nGitHub line.',
      label: 'Jira, Confluence and GitHub',
      github: GITHUB,
      pushLabel: 'git push',
    });
  });

  it('leaves out plans with no tools, and gives none when none has any', () => {
    expect(mergePlans([{ tools: [] }, { tools: [], github: GITHUB }])).toEqual({ tools: [] });
    expect(mergePlans([{ tools: [] }, { tools: [tool('a')] }])).toEqual({ tools: [tool('a')] });
    const many = Array.from({ length: 40 }, (_, i) => tool(`t${i}`));
    expect(mergePlans([{ tools: many }]).tools).toHaveLength(32);
  });

  it('joins labels as a sentence', () => {
    expect(joinLabels([])).toBeUndefined();
    expect(joinLabels(['Jira'])).toBe('Jira');
    expect(joinLabels(['Jira', 'GitHub'])).toBe('Jira and GitHub');
  });
});
