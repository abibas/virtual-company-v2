import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WORKSPACE_GROUPS } from '../../src/check.ts';
import { STRUCTURE_RULES } from '../../src/structure/rules.ts';

const root = resolve(import.meta.dirname, '../../../..');

describe('STRUCTURE_RULES', () => {
  it('has the approved limits: 300 lines of source, 500 of tests', () => {
    expect(STRUCTURE_RULES.maxLines).toEqual({ source: 300, test: 500 });
  });

  it('knows the same workspace groups as pnpm-workspace.yaml and mwc check', () => {
    const workspace = readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8');
    const globs = [...workspace.matchAll(/^ {2}- (\S+)\/\*$/gm)].map((m) => m[1]);
    expect([...STRUCTURE_RULES.workspaceGroups].sort()).toEqual([...globs].sort());
    expect([...STRUCTURE_RULES.workspaceGroups].sort()).toEqual([...WORKSPACE_GROUPS].sort());
  });
});
