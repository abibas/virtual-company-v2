import type { JiraIssue } from '@mwc/tools-core';
import { describe, expect, it } from 'vitest';
import {
  ANSWER_MAX,
  answer,
  compact,
  cut,
  issueView,
  pageView,
  TEXT_LIMITS,
} from '../../../../../src/modules/integrations/rules/atlassian/render.ts';

const ISSUE: JiraIssue = {
  id: '1',
  key: 'AP-1',
  url: 'https://airia.atlassian.net/browse/AP-1',
  project: 'AP',
  summary: 'S',
  status: 'Open',
  type: null,
  priority: null,
  assignee: null,
  reporter: null,
  created: null,
  updated: null,
  resolution: null,
  labels: [],
  components: [],
  description: 'd'.repeat(TEXT_LIMITS.body + 10),
  parent: null,
  subtasks: [],
  links: [],
  comments: [{ id: 'c', author: null, created: null, body: 'c'.repeat(TEXT_LIMITS.comment + 1) }],
  commentsTotal: 12,
  extra: { customfield_1: { value: 'x'.repeat(2000) }, customfield_2: 3 },
};

describe('what an Atlassian tool answers', () => {
  it('cuts a long text, saying how much was left out', () => {
    expect(cut('abc', 3)).toBe('abc');
    expect(cut('abcdef', 3)).toBe('abc\n…[cut: 3 more characters]');
  });

  it('leaves empty fields out', () => {
    expect(compact({ a: 1, b: null, c: '', d: [], e: {}, f: [0], g: false })).toEqual({
      a: 1,
      f: [0],
      g: false,
    });
  });

  it('shows an issue trimmed: its description and comments cut, other fields short, the latest of how many', () => {
    const view = issueView(ISSUE) as Record<string, unknown>;
    expect(Object.keys(view)).toEqual([
      'id',
      'key',
      'url',
      'project',
      'summary',
      'status',
      'description',
      'comments',
      'commentsShown',
      'fields',
    ]);
    expect(view.description).toContain(`…[cut: 10 more characters]`);
    expect(view.commentsShown).toBe('the latest 1 of 12');
    const fields = view.fields as Record<string, unknown>;
    expect(fields.customfield_2).toBe(3);
    expect(String(fields.customfield_1)).toContain('…[cut:');
    const listed = issueView(ISSUE, true) as { description: string };
    expect(listed.description.startsWith('d'.repeat(TEXT_LIMITS.listed))).toBe(true);
    expect(listed.description.length).toBeLessThan(TEXT_LIMITS.listed + 40);
    const quiet = issueView({ ...ISSUE, description: null, comments: [], commentsTotal: 0, extra: {} });
    expect(quiet).not.toHaveProperty('commentsShown');
  });

  it('shows a page with its body cut, and keeps the whole answer under the limit', () => {
    const page = {
      id: '1',
      title: 'T',
      spaceId: '2',
      parentId: null,
      status: 'current',
      version: 1,
      updated: null,
      url: null,
    };
    expect(pageView({ ...page, body: 'b'.repeat(TEXT_LIMITS.body + 1) }).body).toContain(
      '…[cut: 1 more characters]',
    );
    expect(answer({ a: 1 })).toBe('{\n "a": 1\n}');
    const long = answer({ text: 'x'.repeat(ANSWER_MAX) });
    expect(long.length).toBeLessThan(ANSWER_MAX + 100);
    expect(long).toContain('ask for fewer results or fields');
  });
});
