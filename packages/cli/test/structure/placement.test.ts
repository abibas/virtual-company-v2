import { describe, expect, it } from 'vitest';
import { checkPlacement } from '../../src/structure/placement.ts';
import { STRUCTURE_RULES } from '../../src/structure/rules.ts';
import { CLEAN, cleanWith, treeOf } from '../fixtures/tree.ts';

describe('checkPlacement: tests only in test/', () => {
  it('passes a clean tree, fixtures included', () => {
    expect(checkPlacement(treeOf(CLEAN), STRUCTURE_RULES)).toEqual([]);
  });

  it('refuses a test or spec under src/ and says where it goes', () => {
    const found = checkPlacement(
      cleanWith({ 'packages/db/src/a/b.test.ts': '', 'apps/web/src/app/App.spec.tsx': '' }),
      STRUCTURE_RULES,
    );
    expect(found).toEqual([
      {
        path: 'apps/web/src/app/App.spec.tsx',
        rule: 'tests',
        message: 'a test under src/: move it to apps/web/test/app/App.spec.tsx (test/ mirrors src/)',
      },
      {
        path: 'packages/db/src/a/b.test.ts',
        rule: 'tests',
        message: 'a test under src/: move it to packages/db/test/a/b.test.ts (test/ mirrors src/)',
      },
    ]);
  });

  it("refuses a test anywhere else outside a package's test/", () => {
    const found = checkPlacement(
      cleanWith({ 'packages/db/scripts/migrate.test.ts': '', 'deploy/compose.test.ts': '' }),
      STRUCTURE_RULES,
    );
    expect(found.map((v) => v.path)).toEqual([
      'deploy/compose.test.ts',
      'packages/db/scripts/migrate.test.ts',
    ]);
    expect(found[0]?.message).toContain("outside a package's test/");
  });

  it('refuses code in test/ that is not a test, outside test/fixtures/', () => {
    const [found, ...rest] = checkPlacement(
      cleanWith({ 'packages/db/test/helpers.ts': '' }),
      STRUCTURE_RULES,
    );
    expect(rest).toEqual([]);
    expect(found).toMatchObject({ path: 'packages/db/test/helpers.ts', rule: 'tests' });
    expect(found?.message).toContain('move this helper to packages/db/test/fixtures/');
  });
});
