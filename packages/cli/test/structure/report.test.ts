import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  coverageReader,
  formatReport,
  formatSummary,
  structureReport,
  warningsOf,
  warningTitles,
} from '../../src/structure/report.ts';
import { STRUCTURE_RULES } from '../../src/structure/rules.ts';
import type { Warning } from '../../src/structure/warnings.ts';
import { capture } from '../fixtures/io.ts';
import { CLEAN, lines, scanOf } from '../fixtures/tree.ts';

const WARNINGS: Warning[] = [
  { kind: 'near-limit', path: 'packages/a/src/fake.ts', message: '290 of 300 lines (97%)' },
  { kind: 'near-limit', path: 'packages/a/src/store.ts', message: '250 of 300 lines (83%)' },
  { kind: 'long-function', path: 'packages/a/src/check.ts', line: 62, message: 'checkSteps, 73 lines' },
  { kind: 'low-coverage', path: 'packages/a/src/reconcile.ts', message: '100% lines, 86.48% branches' },
];

const summaryOf = (files: Record<string, number>) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(files).map(([path, pct]) => [
        `/repo/${path}`,
        {
          lines: { total: 10, covered: 9, skipped: 0, pct },
          branches: { total: 4, covered: 4, skipped: 0, pct: 100 },
        },
      ]),
    ),
  );

describe('formatReport', () => {
  it('groups the warnings by kind with each threshold, then points at the review', () => {
    expect(formatReport(WARNINGS, 120, true)).toBe(
      [
        'Structure report: 4 warnings in 120 files. They never fail; the thresholds are',
        'the `warn` section of packages/cli/src/structure/rules.ts.',
        '',
        'near-limit, 2: files above 80% of their line limit',
        '  packages/a/src/fake.ts: 290 of 300 lines (97%)',
        '  packages/a/src/store.ts: 250 of 300 lines (83%)',
        '',
        'long-function, 1: named functions over 60 lines',
        '  packages/a/src/check.ts:62: checkSteps, 73 lines',
        '',
        'big-folder, 0: folders with more than 12 entries',
        '',
        'fan-in, 0: files that 8 or more files of their package import (outside test/)',
        '',
        'low-coverage, 1: files under 95% lines or 90% branches in the last coverage run',
        '  packages/a/src/reconcile.ts: 100% lines, 86.48% branches',
        '',
        'Review them with the open lessons at the end of each stage: .claude/skills/keep-structure/references/review.md',
        '',
      ].join('\n'),
    );
  });

  it('leaves out the coverage group when there was no coverage summary to read', () => {
    const text = formatReport(WARNINGS.slice(0, 3), 120, false);
    expect(text).toContain('fan-in, 0');
    expect(text).not.toContain('low-coverage');
  });

  it('names the thresholds of the rules it is given', () => {
    const rules = { ...STRUCTURE_RULES, warn: { ...STRUCTURE_RULES.warn, nearLimit: 0.9, fanIn: 5 } };
    expect(warningTitles(rules)['near-limit']).toBe('files above 90% of their line limit');
    expect(formatReport([], 1, false, rules)).toContain('fan-in, 0: files that 5 or more files');
  });
});

describe('formatSummary', () => {
  it('counts each kind that has warnings and shows the worst of each', () => {
    expect(formatSummary(WARNINGS)).toBe(
      [
        'Structure warnings (never a failure): 2 near-limit, 1 long-function, 1 low-coverage. The worst of each:',
        '  near-limit    packages/a/src/fake.ts: 290 of 300 lines (97%)',
        '  long-function packages/a/src/check.ts:62: checkSteps, 73 lines',
        '  low-coverage  packages/a/src/reconcile.ts: 100% lines, 86.48% branches',
        'All of them: pnpm mwc structure --report',
        '',
      ].join('\n'),
    );
  });

  it('says so when there is nothing to warn about', () => {
    expect(formatSummary([])).toBe('Structure warnings: none (pnpm mwc structure --report)\n');
  });
});

describe('warningsOf and structureReport', () => {
  it('reads the listed files and the coverage summary, with paths relative to the root', () => {
    const scan = scanOf({ 'packages/db/src/a.ts': lines(250) });
    const result = warningsOf(scan.deps, summaryOf({ 'packages/db/src/a.ts': 80 }), '/repo');
    expect(result).toEqual({
      files: 1,
      withCoverage: true,
      warnings: [
        { kind: 'near-limit', path: 'packages/db/src/a.ts', message: '250 of 300 lines (83%)' },
        { kind: 'low-coverage', path: 'packages/db/src/a.ts', message: '80% lines, 100% branches' },
      ],
    });
    expect(warningsOf(scan.deps, undefined, '/repo').withCoverage).toBe(false);
    expect(scan.listings()).toBe(2);
  });

  it('prints the report and exits 0, whatever it finds', () => {
    const c = capture();
    expect(structureReport(c.io, scanOf(CLEAN).deps, () => undefined)).toBe(0);
    expect(c.out()).toMatch(/^Structure report: 2 warnings in \d+ files\./);
    expect(c.out()).toContain('connectors/identity-clerk/src/provider.ts: 300 of 300 lines (100%)');
    expect(c.out()).not.toContain('low-coverage');
    expect(c.err()).toBe('');
  });
});

describe('coverageReader', () => {
  it('reads the summary under the root, and gives undefined when there is none', () => {
    const root = mkdtempSync(join(tmpdir(), 'structure-report-'));
    try {
      const read = coverageReader(root);
      expect(read()).toBeUndefined();
      mkdirSync(join(root, '.cache/coverage'), { recursive: true });
      writeFileSync(join(root, STRUCTURE_RULES.warn.coverageSummary), '{"total":{}}');
      expect(read()).toBe('{"total":{}}');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
