import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { systemScanDeps } from '../../src/banned.ts';
import { checkStructure, formatViolations } from '../../src/structure/check.ts';
import { STRUCTURE_RULES } from '../../src/structure/rules.ts';
import { repoTree } from '../../src/structure/tree.ts';
import { CLEAN, cleanWith, lines, treeOf } from '../fixtures/tree.ts';

describe('checkStructure', () => {
  it('passes a clean tree', () => {
    expect(checkStructure(treeOf(CLEAN))).toEqual([]);
  });

  it('passes this repository (git ls-files with the untracked files)', () => {
    const tree = repoTree(systemScanDeps(resolve(import.meta.dirname, '../../../..')));
    expect(checkStructure(tree)).toEqual([]);
  });

  it('runs every rule: layout, packages, placement, size, modules and docs', () => {
    const found = checkStructure(
      cleanWith({
        'tools/x.ts': '',
        'packages/db/tsconfig.json': undefined,
        'packages/db/src/a.test.ts': '',
        'packages/db/src/big.ts': lines(301),
        'apps/server/src/modules/members/helpers.ts': '',
        '.claude/skills/keep-structure/SKILL.md': undefined,
      }),
    );
    expect(found.map((v) => v.rule)).toEqual(['layout', 'package', 'tests', 'size', 'modules', 'docs']);
  });

  it('takes other rules', () => {
    const strict = { ...STRUCTURE_RULES, maxLines: { source: 10, test: 10 } };
    expect(checkStructure(treeOf(CLEAN), strict).map((v) => v.path)).toContain(
      'apps/server/test/modules/health/routes.test.ts',
    );
  });
});

describe('formatViolations', () => {
  it('prints path, line when there is one, rule and message, then the hint; nothing when all is well', () => {
    const text = formatViolations([
      { path: 'a/b.ts', line: 301, rule: 'size', message: 'too long' },
      { path: 'tools/', rule: 'layout', message: 'unknown' },
    ]);
    expect(text).toBe(`a/b.ts:301: [size] too long\ntools/: [layout] unknown\n${STRUCTURE_RULES.hint}\n`);
    expect(formatViolations([])).toBe('');
  });

  it('points at the rules and the skill', () => {
    expect(STRUCTURE_RULES.hint).toContain('docs/structure.md');
    expect(STRUCTURE_RULES.hint).toContain('see .claude/skills/keep-structure');
  });
});
