import { describe, expect, it } from 'vitest';
import { STRUCTURE_RULES } from '../../src/structure/rules.ts';
import { checkSize, measure, sizeExempt } from '../../src/structure/size.ts';
import { CLEAN, cleanWith, lines, treeOf } from '../fixtures/tree.ts';

describe('checkSize', () => {
  it('passes a clean tree: files at the limits, generated files and docs of any length', () => {
    expect(checkSize(treeOf(CLEAN), STRUCTURE_RULES)).toEqual([]);
  });

  it('refuses a source file over 300 lines, at the first line over the limit', () => {
    expect(checkSize(cleanWith({ 'packages/db/src/big.ts': lines(301) }), STRUCTURE_RULES)).toEqual([
      {
        path: 'packages/db/src/big.ts',
        line: 301,
        rule: 'size',
        message: '301 lines, over the 300-line limit for source files: split it by responsibility',
      },
    ]);
  });

  it('allows 500 lines in test/, fixtures included, and refuses 501', () => {
    const tree = cleanWith({
      'packages/db/test/fixtures/world.ts': lines(500),
      'apps/server/test/app.test.ts': lines(501),
    });
    expect(checkSize(tree, STRUCTURE_RULES)).toEqual([
      {
        path: 'apps/server/test/app.test.ts',
        line: 501,
        rule: 'size',
        message: '501 lines, over the 500-line limit for test files: split it by responsibility',
      },
    ]);
  });

  it('limits every other text file like source, and skips binary and missing files', () => {
    const tree = treeOf({
      ...CLEAN,
      'deploy/compose.prod.yml': lines(301),
      'docs/big.png': new Uint8Array(4000),
      'packages/db/src/gone.ts': undefined,
    });
    expect(checkSize(tree, STRUCTURE_RULES).map((v) => v.path)).toEqual(['deploy/compose.prod.yml']);
  });

  it('exempts the lockfile, the migrations with their meta, the schema doc and Markdown', () => {
    for (const path of [
      'pnpm-lock.yaml',
      'packages/db/migrations/0001_identity.sql',
      'packages/db/migrations/meta/_journal.json',
      'docs/schema.md',
      'docs/architecture.md',
      'packages/db/README.md',
    ]) {
      expect(sizeExempt(path, STRUCTURE_RULES)).toBe(true);
    }
    expect(sizeExempt('packages/db/src/migrations.ts', STRUCTURE_RULES)).toBe(false);
    expect(sizeExempt('docs/schema.md.ts', STRUCTURE_RULES)).toBe(false);
  });

  it('measures a limited file against its limit, and nothing for exempt, binary or missing files', () => {
    const tree = cleanWith({
      'packages/db/src/gone.ts': undefined,
      'packages/db/src/logo.png': new Uint8Array([0]),
    });
    expect(measure(tree, 'connectors/identity-clerk/src/provider.ts', STRUCTURE_RULES)).toEqual({
      kind: 'source',
      lines: 300,
      limit: 300,
    });
    expect(measure(tree, 'packages/db/test/fixtures/rows.ts', STRUCTURE_RULES)).toEqual({
      kind: 'test',
      lines: 10,
      limit: 500,
    });
    for (const path of ['docs/schema.md', 'packages/db/src/logo.png', 'packages/db/src/gone.ts']) {
      expect(measure(tree, path, STRUCTURE_RULES)).toBeUndefined();
    }
  });
});
