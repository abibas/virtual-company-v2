import { describe, expect, it } from 'vitest';
import { STRUCTURE_RULES } from '../../src/structure/rules.ts';
import { firstEntry, lineCount, matches, packageOf, repoTree } from '../../src/structure/tree.ts';
import { scanOf } from '../fixtures/tree.ts';

describe('repoTree', () => {
  it('lists each path once, sorted, and reads each file at most once', () => {
    const scan = scanOf({ 'b.ts': 'b\n', 'a.ts': 'a\n' });
    const tree = repoTree({ ...scan.deps, listFiles: () => ['b.ts', 'a.ts', 'b.ts'] });
    expect(tree.paths).toEqual(['a.ts', 'b.ts']);
    expect(tree.text('a.ts')).toBe('a\n');
    expect(tree.text('a.ts')).toBe('a\n');
    expect(scan.reads.get('a.ts')).toBe(1);
  });

  it('gives no text for a binary file or one gone from the working tree', () => {
    const tree = repoTree(scanOf({ 'logo.png': new Uint8Array([1, 0, 2]), 'gone.ts': undefined }).deps);
    expect(tree.text('logo.png')).toBeUndefined();
    expect(tree.text('gone.ts')).toBeUndefined();
  });
});

describe('helpers', () => {
  it('counts lines: none in an empty file, and a final newline starts no new line', () => {
    expect([lineCount(''), lineCount('a'), lineCount('a\n'), lineCount('a\nb'), lineCount('\n\n')]).toEqual([
      0, 1, 1, 2, 2,
    ]);
  });

  it('finds the workspace package of a path', () => {
    expect(packageOf('packages/db/src/a.ts', STRUCTURE_RULES)).toEqual({
      pkg: 'packages/db',
      inner: 'src/a.ts',
    });
    expect(packageOf('connectors/jira/package.json', STRUCTURE_RULES)).toEqual({
      pkg: 'connectors/jira',
      inner: 'package.json',
    });
    for (const path of ['packages/README.md', 'docs/a/b.md', 'package.json']) {
      expect(packageOf(path, STRUCTURE_RULES)).toBeUndefined();
    }
  });

  it('matches files exactly and folders by prefix, and names the first entry of a path', () => {
    expect(matches('docs/schema.md', 'docs/schema.md')).toBe(true);
    expect(matches('docs/schema.md.bak', 'docs/schema.md')).toBe(false);
    expect(matches('packages/db/migrations/meta/x.json', 'packages/db/migrations/')).toBe(true);
    expect([firstEntry('apps/web/src/a.ts'), firstEntry('README.md')]).toEqual(['apps/', 'README.md']);
  });
});
