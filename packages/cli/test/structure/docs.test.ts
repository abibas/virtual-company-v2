import { describe, expect, it } from 'vitest';
import { checkDocs, mentions, warnFigures } from '../../src/structure/docs.ts';
import { STRUCTURE_RULES } from '../../src/structure/rules.ts';
import { skillDoc, structureDoc } from '../fixtures/docs.ts';
import { CLEAN, cleanWith, treeOf } from '../fixtures/tree.ts';

const MAP = 'docs/structure.md';
const SKILL = '.claude/skills/keep-structure/SKILL.md';

/** The docs rule's findings as `path[:line]: message`. */
const found = (changes: Parameters<typeof cleanWith>[0], rules = STRUCTURE_RULES) =>
  checkDocs(cleanWith(changes), rules).map(
    (v) => `${v.path}${v.line === undefined ? '' : `:${v.line}`}: ${v.message}`,
  );

describe('checkDocs: docs/structure.md and the skill say what rules.ts holds', () => {
  it('passes a clean tree, whose docs state every rule', () => {
    expect(checkDocs(treeOf(CLEAN), STRUCTURE_RULES)).toEqual([]);
  });

  it('wants both documents', () => {
    expect(checkDocs(treeOf({ 'README.md': '' }), STRUCTURE_RULES)).toEqual([
      {
        path: MAP,
        rule: 'docs',
        message: 'missing: it describes the rules of packages/cli/src/structure/rules.ts',
      },
      {
        path: SKILL,
        rule: 'docs',
        message: 'missing: it describes the rules of packages/cli/src/structure/rules.ts',
      },
    ]);
  });

  it('names a new top-level entry, workspace group and module file the map does not have', () => {
    const rules = {
      ...STRUCTURE_RULES,
      topLevel: [...STRUCTURE_RULES.topLevel, 'tools/', '.npmrc'],
      workspaceGroups: [...STRUCTURE_RULES.workspaceGroups, 'services'],
      modules: { ...STRUCTURE_RULES.modules, files: [...STRUCTURE_RULES.modules.files, 'events.ts'] },
    };
    expect(found({}, rules)).toEqual([
      `${MAP}: does not mention the top-level entry tools/ (topLevel)`,
      `${MAP}: does not mention the top-level entry .npmrc (topLevel)`,
      `${MAP}: does not list the workspace group \`services/*\` (workspaceGroups)`,
      `${MAP}: has no row for the module file \`events.ts\` (modules.files)`,
      `${SKILL}: does not mention the module file events.ts (modules.files)`,
    ]);
  });

  it('names a module file the docs still list or place code in after rules.ts dropped it, with its line', () => {
    const rules = {
      ...STRUCTURE_RULES,
      modules: {
        ...STRUCTURE_RULES.modules,
        files: STRUCTURE_RULES.modules.files.filter((f) => f !== 'rules.ts'),
      },
    };
    const mapLine = structureDoc().split('\n').indexOf('  | `rules.ts` | a role |') + 1;
    const skillLine =
      skillDoc()
        .split('\n')
        .findIndex((line) => line.includes('<area>/rules.ts')) + 1;
    expect(found({}, rules)).toEqual([
      `${MAP}:${mapLine}: lists the module file \`rules.ts\`, which modules.files does not have`,
      `${SKILL}:${skillLine}: places code in modules/<area>/rules.ts, which modules.files does not have`,
    ]);
  });

  it('wants the line limits of rules.ts in both documents', () => {
    const rules = { ...STRUCTURE_RULES, maxLines: { source: 350, test: 600 } };
    expect(found({}, rules)).toEqual([
      `${MAP}: does not state the 350-line limit for source files (maxLines)`,
      `${MAP}: does not state the 600-line limit for test files (maxLines)`,
      `${SKILL}: does not state the 350-line limit for source files (maxLines)`,
      `${SKILL}: does not state the 600-line limit for test files (maxLines)`,
    ]);
    expect(found({ [SKILL]: skillDoc().replace('≤ 500', '≤ 5000') })).toEqual([
      `${SKILL}: does not state the 500-line limit for test files (maxLines)`,
    ]);
  });

  it('wants a warnings row per kind that states its thresholds', () => {
    const rules = {
      ...STRUCTURE_RULES,
      warn: { ...STRUCTURE_RULES.warn, nearLimit: 0.75, coverage: { lines: 95, branches: 80 } },
    };
    expect(found({}, rules)).toEqual([
      `${MAP}: has no warnings row for \`near-limit\` stating 75% (warn)`,
      `${MAP}: has no warnings row for \`low-coverage\` stating 95% and 80% (warn)`,
    ]);
    const noFanInRow = structureDoc().replace(/^\| `fan-in` .*$/m, '| `fan-out` | 8 |');
    expect(found({ [MAP]: noFanInRow })).toEqual([
      `${MAP}: has no warnings row for \`fan-in\` stating 8 (warn)`,
    ]);
    const otherFigure = structureDoc().replace(/^(\| `fan-in` \|) 8 \|$/m, '$1 18, 8.5 |');
    expect(found({ [MAP]: otherFigure })).toEqual([
      `${MAP}: has no warnings row for \`fan-in\` stating 8 (warn)`,
    ]);
  });
});

describe('helpers', () => {
  it('finds a file or folder written as a name of its own, not as the tail of another name or path', () => {
    expect(mentions('the root `package.json`', 'package.json')).toBe(true);
    expect(mentions('in `packages/db/package.json`', 'package.json')).toBe(false);
    expect(mentions('in `packages/db/package.json`', 'package.json', true)).toBe(true);
    expect(mentions('see `package.json.bak`', 'package.json')).toBe(false);
    expect(mentions('the `.vscode/settings.json`', '.vscode/')).toBe(true);
    expect(mentions('├── docs/   architecture', 'docs/')).toBe(true);
    expect(mentions('the `mydocs/` folder', 'docs/')).toBe(false);
    expect(mentions('a file `.env.example`', '.env.example')).toBe(true);
    expect(mentions('a file `x.env.example`', '.env.example')).toBe(false);
  });

  it('gives the figures of each kind of warning from rules.ts', () => {
    expect(warnFigures(STRUCTURE_RULES)).toEqual({
      'near-limit': ['80%'],
      'long-function': ['60'],
      'big-folder': ['12'],
      'fan-in': ['8'],
      'low-coverage': ['95%', '90%'],
    });
  });
});
