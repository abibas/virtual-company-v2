import { describe, expect, it } from 'vitest';
import { STRUCTURE_RULES } from '../../src/structure/rules.ts';
import {
  lowCoverage,
  parseCoverage,
  structureWarnings,
  WARNING_KINDS,
} from '../../src/structure/warnings.ts';
import { CLEAN, cleanWith, lines, treeOf } from '../fixtures/tree.ts';

/** A function `name` of `n` lines in all. */
const fn = (name: string, n: number) => `export function ${name}() {\n${lines(n - 2)}}\n`;
const imports = (target: string) => `import { x } from '${target}';\n`;

describe('structureWarnings', () => {
  it('finds the limited files of the clean tree that are near their limit, and nothing else', () => {
    expect(structureWarnings(treeOf(CLEAN), undefined)).toEqual([
      {
        kind: 'near-limit',
        path: 'apps/server/test/modules/health/routes.test.ts',
        message: '500 of 500 lines (100%)',
      },
      {
        kind: 'near-limit',
        path: 'connectors/identity-clerk/src/provider.ts',
        message: '300 of 300 lines (100%)',
      },
    ]);
  });

  it('warns above 80% of the limit, test files against theirs, worst first; generated files and docs never', () => {
    const tree = treeOf({
      'packages/db/src/a.ts': lines(241),
      'packages/db/src/b.ts': lines(240),
      'packages/db/src/c.ts': lines(290),
      'packages/db/test/a.test.ts': lines(401),
      'packages/db/test/b.test.ts': lines(300),
      'packages/db/migrations/0001.sql': lines(1000),
      'docs/long.md': lines(1000),
    });
    expect(structureWarnings(tree, undefined).map((w) => `${w.path}: ${w.message}`)).toEqual([
      'packages/db/src/c.ts: 290 of 300 lines (97%)',
      'packages/db/src/a.ts: 241 of 300 lines (80%)',
      'packages/db/test/a.test.ts: 401 of 500 lines (80%)',
    ]);
  });

  it('warns on named functions over 60 lines, at their header, in code files only', () => {
    const tree = treeOf({
      'packages/db/src/a.ts': `${fn('short', 60)}${fn('long', 61)}${fn('longer', 90)}`,
      'packages/db/test/fixtures/world.ts': fn('buildScenario', 70),
      'docs/notes.txt': fn('prose', 70),
    });
    expect(structureWarnings(tree, undefined)).toEqual([
      { kind: 'long-function', path: 'packages/db/src/a.ts', line: 122, message: 'longer, 90 lines' },
      {
        kind: 'long-function',
        path: 'packages/db/test/fixtures/world.ts',
        line: 1,
        message: 'buildScenario, 70 lines',
      },
      { kind: 'long-function', path: 'packages/db/src/a.ts', line: 61, message: 'long, 61 lines' },
    ]);
  });

  it('warns on folders with more than 12 direct entries, files and folders, except generated ones', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 12; i++) files[`packages/db/src/f${i}.ts`] = '';
    files['packages/db/src/nested/a.ts'] = '';
    files['packages/db/src/nested/b.ts'] = '';
    for (let i = 0; i < 12; i++) files[`packages/shared/src/f${i}.ts`] = '';
    for (let i = 0; i < 20; i++) files[`packages/db/migrations/meta/${i}.json`] = '';
    expect(structureWarnings(treeOf(files), undefined)).toEqual([
      { kind: 'big-folder', path: 'packages/db/src/', message: '13 entries' },
    ]);
  });

  it('warns on files that 8 or more files of their package import, counting each importer once', () => {
    const files: Record<string, string> = { 'packages/db/src/rules.ts': '', 'packages/db/src/tree.ts': '' };
    for (let i = 0; i < 7; i++)
      files[`packages/db/src/r${i}.ts`] = imports('./rules.ts') + imports('./rules.ts');
    files['packages/db/src/deep/r.ts'] =
      `${imports('../rules.ts')}${imports('../tree.ts')}${imports('./r.ts')}`;
    for (let i = 0; i < 9; i++) files[`packages/db/test/r${i}.test.ts`] = imports('../src/tree.ts');
    files['packages/shared/src/x.ts'] = imports('../../db/src/tree.ts');
    files['packages/db/src/y.ts'] =
      `${imports('./missing.ts')}${imports('@mwc/shared')}${imports('./tree.ts')}`;
    files['vitest.config.ts'] = imports('./packages/db/src/rules.ts');
    expect(structureWarnings(treeOf(files), undefined)).toEqual([
      { kind: 'fan-in', path: 'packages/db/src/rules.ts', message: 'imported by 8 files' },
    ]);
  });

  it('adds the weakest-covered files of the last coverage run, and lists every kind in order', () => {
    const tree = cleanWith({ 'packages/db/src/schema/users.ts': fn('big', 70) });
    const found = structureWarnings(tree, [
      { path: 'packages/db/src/a.ts', lines: 100, branches: 100 },
      { path: 'packages/db/src/b.ts', lines: 94, branches: 100 },
      { path: 'packages/db/src/c.ts', lines: 100, branches: 80 },
    ]);
    expect(found.map((w) => w.kind)).toEqual([
      'near-limit',
      'near-limit',
      'long-function',
      'low-coverage',
      'low-coverage',
    ]);
    expect(found.slice(3).map((w) => w.path)).toEqual(['packages/db/src/c.ts', 'packages/db/src/b.ts']);
    expect(WARNING_KINDS).toEqual(['near-limit', 'long-function', 'big-folder', 'fan-in', 'low-coverage']);
  });
});

describe('lowCoverage', () => {
  it('lists the files under 95% lines or 90% branches', () => {
    const found = lowCoverage([
      { path: 'a.ts', lines: 100, branches: 100 },
      { path: 'b.ts', lines: 93.84, branches: 91.22 },
      { path: 'c.ts', lines: 100, branches: 86.48 },
      { path: 'd.ts', lines: 95, branches: 90 },
    ]);
    expect(found.map(({ path, message }) => `${path}: ${message}`)).toEqual([
      'b.ts: 93.84% lines, 91.22% branches',
      'c.ts: 100% lines, 86.48% branches',
    ]);
    expect(found.map((w) => w.kind)).toEqual(['low-coverage', 'low-coverage']);
    const strict = {
      ...STRUCTURE_RULES,
      warn: { ...STRUCTURE_RULES.warn, coverage: { lines: 100, branches: 0 } },
    };
    expect(lowCoverage([{ path: 'd.ts', lines: 99, branches: 0 }], strict)).toHaveLength(1);
  });
});

describe('parseCoverage', () => {
  const metric = (total: number, pct: number) => ({ total, covered: 0, skipped: 0, pct });

  it('reads each file of a json-summary report relative to the root, without the total and type-only files', () => {
    const json = JSON.stringify({
      total: { lines: metric(10, 99), branches: metric(10, 99) },
      '/repo/packages/db/src/a.ts': { lines: metric(10, 93.84), branches: metric(4, 75) },
      '/repo/packages/db/src/types.ts': { lines: metric(0, 0), branches: metric(0, 0) },
      '/repo/packages/db/src/flat.ts': { lines: metric(5, 100), branches: metric(0, 0) },
      '/elsewhere/b.ts': { lines: metric(1, 50) },
      '/repo/odd.ts': { lines: 'n/a' },
      '/repo/empty.ts': null,
    });
    expect(parseCoverage(json, '/repo')).toEqual([
      { path: 'packages/db/src/a.ts', lines: 93.84, branches: 75 },
      { path: 'packages/db/src/flat.ts', lines: 100, branches: 100 },
      { path: '/elsewhere/b.ts', lines: 50, branches: 100 },
    ]);
  });

  it('gives nothing without a report, or for one that is not a JSON object', () => {
    expect(parseCoverage(undefined, '/repo')).toBeUndefined();
    expect(parseCoverage('{ broken', '/repo')).toBeUndefined();
    expect(parseCoverage('null', '/repo')).toBeUndefined();
    expect(parseCoverage('[]', '/repo')).toEqual([]);
  });
});
