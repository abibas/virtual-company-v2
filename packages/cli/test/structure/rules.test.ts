import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WORKSPACE_GROUPS } from '../../src/check.ts';
import { STRUCTURE_RULES } from '../../src/structure/rules.ts';

const root = resolve(import.meta.dirname, '../../../..');

describe('STRUCTURE_RULES', () => {
  it('has the approved limits: 300 lines of source, 500 of tests', () => {
    expect(STRUCTURE_RULES.maxLines).toEqual({ source: 300, test: 500 });
  });

  it('has the approved early-warning thresholds, and reads coverage where the root vitest.config.ts writes it', () => {
    expect(STRUCTURE_RULES.warn).toEqual({
      nearLimit: 0.8,
      functionLines: 60,
      folderEntries: 12,
      folderEntriesFor: { 'apps/web/src/components/*/': 20, 'packages/db/src/schema/': 20 },
      fanIn: 8,
      fanInGroups: ['apps/server/src/modules/*/'],
      fanInExempt: ['apps/web/src/components/', 'apps/web/src/api/', 'apps/web/src/app/'],
      coverage: { lines: 95, branches: 90 },
      coverageSummary: '.cache/coverage/coverage-summary.json',
    });
    const vitest = readFileSync(resolve(root, 'vitest.config.ts'), 'utf8');
    expect(vitest).toContain("reportsDirectory: '.cache/coverage'");
    expect(vitest).toContain("'json-summary'");
  });

  it('keeps the documents the docs rule checks', () => {
    for (const doc of Object.values(STRUCTURE_RULES.docs))
      expect(existsSync(resolve(root, doc)), doc).toBe(true);
  });

  it('knows the same workspace groups as pnpm-workspace.yaml and mwc check', () => {
    const workspace = readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8');
    const globs = [...workspace.matchAll(/^ {2}- (\S+)\/\*$/gm)].map((m) => m[1]);
    expect([...STRUCTURE_RULES.workspaceGroups].sort()).toEqual([...globs].sort());
    expect([...STRUCTURE_RULES.workspaceGroups].sort()).toEqual([...WORKSPACE_GROUPS].sort());
  });

  it('points at the keep-structure skill, which exists with its name, a description and its references', () => {
    const dir = resolve(root, '.claude/skills/keep-structure');
    const skill = readFileSync(resolve(dir, 'SKILL.md'), 'utf8');
    const front = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? '';
    expect(front).toMatch(/^name: keep-structure$/m);
    expect(front).toMatch(/^description: .*schema.*/m);
    expect(skill.split('\n').length).toBeLessThanOrEqual(150);
    const links = [...skill.matchAll(/\]\((references\/[^)]+)\)/g)].map((m) => m[1] ?? '');
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(existsSync(resolve(dir, link)), link).toBe(true);
    expect(STRUCTURE_RULES.hint).toContain('.claude/skills/keep-structure');
  });
});
