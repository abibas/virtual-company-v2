import { describe, expect, it } from 'vitest';
import {
  commitView,
  contentsView,
  diffView,
  fileView,
  GITHUB_TEXT_LIMITS,
  issueView,
  pullView,
} from '../../../../../src/modules/integrations/rules/github/render.ts';

const PULL = {
  number: 7,
  title: 'T',
  state: 'open',
  draft: false,
  merged: false,
  url: 'u',
  repository: 'a/b',
  author: null,
  head: 'h',
  base: 'main',
  labels: [],
  createdAt: null,
  updatedAt: null,
  nodeId: 'PR_7',
  body: 'x'.repeat(GITHUB_TEXT_LIMITS.body + 5),
  headSha: 's',
  headRepository: null,
  mergeable: null,
  mergeableState: null,
  comments: 0,
  reviewComments: null,
  commits: null,
  additions: null,
  deletions: null,
  changedFiles: null,
  requestedReviewers: [],
  mergedAt: null,
  closedAt: null,
};

describe('what a GitHub tool answers', () => {
  it('a pull request without its node id or empty fields, its body cut', () => {
    const view = pullView(PULL);
    expect(view).not.toHaveProperty('nodeId');
    expect(view).not.toHaveProperty('labels');
    expect(view).not.toHaveProperty('author');
    expect(view.comments).toBe(0);
    expect(view.body).toContain('[cut: 5 more characters]');
    expect(pullView({ ...PULL, body: null })).not.toHaveProperty('body');
  });

  it('an issue’s body short in a list and long when read; patches and diffs cut', () => {
    const hit = { ...PULL, isPullRequest: true, comments: null, closedAt: null, body: 'y'.repeat(600) };
    expect(String(issueView(hit).body)).toContain('[cut: 100 more characters]');
    expect(issueView(hit, true).body).toBe('y'.repeat(600));
    const file = {
      filename: 'a',
      status: 'modified',
      additions: 1,
      deletions: 0,
      patch: 'p'.repeat(3001),
      previousFilename: null,
    };
    expect(String(fileView(file).patch)).toContain('[cut: 1 more characters]');
    expect(fileView({ ...file, patch: null })).not.toHaveProperty('patch');
    expect(diffView('d'.repeat(40_001)).diff).toContain('[cut: 1 more characters]');
    const commit = { sha: 's', message: 'm', author: null, date: null, url: null, files: [file] };
    expect(commitView(commit).files).toHaveLength(1);
  });

  it('a file’s text, a file that is not text, and a folder', () => {
    const file = { kind: 'file', path: 'a.ts', sha: 's', size: 3, text: 'abc' } as const;
    expect(contentsView(file)).toEqual(file);
    expect(contentsView({ ...file, text: null })).toMatchObject({
      text: null,
      note: expect.stringContaining('not text'),
    });
    const dir = { kind: 'dir', path: 'src', entries: [] } as const;
    expect(contentsView(dir)).toBe(dir);
  });
});
