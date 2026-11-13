import { describe, expect, it } from 'vitest';
import {
  DROP_FIRST,
  fitTools,
  joinLabels,
  leftOutLine,
  mergePlans,
} from '../../../../src/modules/integrations/rules/plans.ts';

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
    const many = Array.from({ length: 70 }, (_, i) => tool(`t${i}`));
    expect(mergePlans([{ tools: many }]).tools).toHaveLength(64);
  });

  it('keeps at most a runner’s limit: the least important left out first, named in a last line', () => {
    const names = [
      'getJiraIssue',
      'request_copilot_review',
      'pull_request_read',
      'slack_get_user_profile',
      'x',
    ];
    const merged = mergePlans([{ tools: names.map(tool), instructions: 'Line.', label: 'Slack' }], 3);
    expect(merged.tools.map((one) => one.name)).toEqual(['getJiraIssue', 'pull_request_read', 'x']);
    expect(merged).toMatchObject({
      instructions: `Line.\n${leftOutLine(3, ['request_copilot_review', 'slack_get_user_profile'])}`,
      leftOut: ['request_copilot_review', 'slack_get_user_profile'],
      total: 5,
    });
    expect(leftOutLine(32, ['a', 'b'])).toBe(
      "This machine's runner takes at most 32 tools, so these are left out now: a, b; tell the person to update " +
        'the runner on the Machines page to get them.',
    );
    expect(mergePlans([{ tools: names.map(tool) }], 64)).not.toHaveProperty('leftOut');
  });

  it('drops the last tools when the stated order is not enough', () => {
    const fitted = fitTools(['a', 'b', 'request_copilot_review', 'c'].map(tool), 2);
    expect(fitted.kept.map((one) => one.name)).toEqual(['a', 'b']);
    expect(fitted.left).toEqual(['request_copilot_review', 'c']);
    expect(fitTools([tool('a')], 0)).toEqual({ kept: [], left: ['a'] });
    expect(DROP_FIRST).toContain('slack_get_users');
    expect(DROP_FIRST).not.toContain('slack_post_message');
  });

  it('fits Atlassian’s 15, GitHub’s 14 and Slack’s 9 in an older runner’s 32, leaving 6 out', () => {
    const atlassian = Array.from({ length: 11 }, (_, i) => tool(`jira${i}`)).concat(
      [
        'getConfluenceSpaces',
        'getPagesInConfluenceSpace',
        'getVisibleJiraProjects',
        'lookupJiraAccountId',
      ].map(tool),
    );
    const github = Array.from({ length: 10 }, (_, i) => tool(`gh${i}`)).concat(
      ['request_copilot_review', 'search_repositories', 'list_branches', 'get_commit'].map(tool),
    );
    const slack = Array.from({ length: 8 }, (_, i) => tool(`slack${i}`)).concat([
      tool('slack_get_user_profile'),
    ]);
    const merged = mergePlans([{ tools: atlassian }, { tools: github }, { tools: slack }], 32);
    expect(merged.tools).toHaveLength(32);
    expect(merged.leftOut).toEqual([
      'request_copilot_review',
      'slack_get_user_profile',
      'search_repositories',
      'list_branches',
      'getPagesInConfluenceSpace',
      'getConfluenceSpaces',
    ]);
  });

  it('joins labels as a sentence', () => {
    expect(joinLabels([])).toBeUndefined();
    expect(joinLabels(['Jira'])).toBe('Jira');
    expect(joinLabels(['Jira', 'GitHub'])).toBe('Jira and GitHub');
  });
});
