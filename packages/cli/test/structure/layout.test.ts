import { describe, expect, it } from 'vitest';
import { checkLayout, checkPackages, workspacePackagesIn } from '../../src/structure/layout.ts';
import { STRUCTURE_RULES } from '../../src/structure/rules.ts';
import { CLEAN, cleanWith, treeOf } from '../fixtures/tree.ts';

describe('checkLayout: known top-level entries, packages only in the groups', () => {
  it('passes a clean tree', () => {
    expect(checkLayout(treeOf(CLEAN), STRUCTURE_RULES)).toEqual([]);
  });

  it('reports an unknown top-level folder once, at its first file, and an unknown root file', () => {
    const found = checkLayout(
      cleanWith({ 'tools/a.ts': '', 'tools/b.ts': '', 'notes.txt': '' }),
      STRUCTURE_RULES,
    );
    expect(found.map((v) => [v.path, v.message])).toEqual([
      [
        'notes.txt',
        'notes.txt is not a known top-level entry; code goes in apps/, packages/, connectors/ (see the map)',
      ],
      [
        'tools/a.ts',
        'tools/ is not a known top-level entry; code goes in apps/, packages/, connectors/ (see the map)',
      ],
    ]);
  });

  it('refuses a file loose in a group folder and a package.json below a package root', () => {
    const found = checkLayout(
      cleanWith({
        'packages/README.md': '',
        'packages/db/src/vendor/package.json': '{}',
        'deploy/tools/package.json': '{}',
      }),
      STRUCTURE_RULES,
    );
    expect(found.map((v) => [v.path, v.rule])).toEqual([
      ['deploy/tools/package.json', 'layout'],
      ['packages/README.md', 'layout'],
      ['packages/db/src/vendor/package.json', 'layout'],
    ]);
    expect(found[0]?.message).toContain(
      'a workspace package lives directly in apps/, packages/, connectors/',
    );
    expect(found[1]?.message).toBe('only package folders go in packages/');
  });

  it('lists the workspace packages of a tree', () => {
    expect(workspacePackagesIn(treeOf(CLEAN), STRUCTURE_RULES)).toEqual([
      'apps/server',
      'apps/web',
      'connectors/identity-clerk',
      'packages/db',
    ]);
  });
});

describe('checkPackages: what a package has', () => {
  it('passes a clean tree, with each package’s own tool configuration', () => {
    expect(checkPackages(treeOf(CLEAN), STRUCTURE_RULES)).toEqual([]);
  });

  it('wants package.json, tsconfig.json and src/, and in a tested package vitest.config.ts and tests', () => {
    const found = checkPackages(
      cleanWith({
        'connectors/identity-clerk/tsconfig.json': undefined,
        'connectors/identity-clerk/vitest.config.ts': undefined,
        'connectors/identity-clerk/test/provider.test.ts': undefined,
        'packages/notes/package.json': '{}',
      }),
      STRUCTURE_RULES,
    );
    expect(found.map((v) => `${v.path}: ${v.message}`)).toEqual([
      'connectors/identity-clerk/tsconfig.json: missing',
      'connectors/identity-clerk/vitest.config.ts: missing',
      'connectors/identity-clerk/test/: missing',
      'packages/notes/tsconfig.json: missing',
      'packages/notes/src/: missing',
      'packages/notes/vitest.config.ts: missing',
      'packages/notes/test/: missing',
    ]);
  });

  it('wants at least one test in test/, fixtures are not enough', () => {
    const found = checkPackages(cleanWith({ 'packages/db/test/schema.test.ts': undefined }), STRUCTURE_RULES);
    expect(found).toEqual([
      { path: 'packages/db/test/', rule: 'package', message: 'has no tests (*.test.ts)' },
    ]);
  });

  it('refuses tests in a package without tests for now (apps/web)', () => {
    const found = checkPackages(
      cleanWith({ 'apps/web/vitest.config.ts': '', 'apps/web/test/app.test.tsx': '' }),
      STRUCTURE_RULES,
    );
    expect(found.map((v) => [v.path, v.message])).toEqual([
      ['apps/web/test/', 'apps/web has no tests for now (docs/structure.md)'],
      ['apps/web/vitest.config.ts', 'apps/web has no tests for now (docs/structure.md)'],
    ]);
  });

  it('refuses anything else at a package root; extras belong to their own package only', () => {
    const found = checkPackages(
      cleanWith({
        'apps/server/lib/util.ts': '',
        'apps/server/migrations/0000.sql': '',
        'apps/server/index.html': '',
      }),
      STRUCTURE_RULES,
    );
    expect(found.map((v) => v.path)).toEqual([
      'apps/server/index.html',
      'apps/server/lib/',
      'apps/server/migrations/',
    ]);
    expect(found[0]?.message).toBe(
      'not part of a package (allowed: package.json, tsconfig.json, src/, vitest.config.ts, test/, README.md, scripts/)',
    );
  });
});
