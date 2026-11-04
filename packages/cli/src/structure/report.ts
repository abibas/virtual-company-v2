import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ScanDeps, systemScanDeps } from '../banned.ts';
import { type MainIo, REPO_ROOT } from '../io.ts';
import { STRUCTURE_RULES, type StructureRules } from './rules.ts';
import { repoTree } from './tree.ts';
import {
  parseCoverage,
  structureWarnings,
  WARNING_KINDS,
  type Warning,
  type WarningKind,
} from './warnings.ts';

/** Where the report says the thresholds are. */
const RULES_FILE = 'packages/cli/src/structure/rules.ts';
const REVIEW = '.claude/skills/keep-structure/references/review.md';

/** What each kind of warning lists, with its threshold from `rules.warn`. */
export function warningTitles(rules: StructureRules = STRUCTURE_RULES): Record<WarningKind, string> {
  const { warn } = rules;
  return {
    'near-limit': `files above ${Math.round(warn.nearLimit * 100)}% of their line limit`,
    'long-function': `named functions over ${warn.functionLines} lines`,
    'big-folder': `folders with more than ${warn.folderEntries} entries`,
    'fan-in': `files that ${warn.fanIn} or more files of their package import (outside test/)`,
    'low-coverage': `files under ${warn.coverage.lines}% lines or ${warn.coverage.branches}% branches in the last coverage run`,
  };
}

/** `path[:line]: message`. */
function item(warning: Warning): string {
  return `${warning.path}${warning.line === undefined ? '' : `:${warning.line}`}: ${warning.message}`;
}

/** The warnings of each kind, in the report's order. */
function byKind(warnings: readonly Warning[]): Map<WarningKind, Warning[]> {
  const kinds = new Map<WarningKind, Warning[]>(WARNING_KINDS.map((kind) => [kind, []]));
  for (const warning of warnings) kinds.get(warning.kind)?.push(warning);
  return kinds;
}

/**
 * `mwc structure --report`: every warning, grouped by kind with its threshold, worst first. The
 * low-coverage group is left out when there was no coverage summary to read.
 */
export function formatReport(
  warnings: readonly Warning[],
  files: number,
  withCoverage: boolean,
  rules: StructureRules = STRUCTURE_RULES,
): string {
  const titles = warningTitles(rules);
  const out = [
    `Structure report: ${warnings.length} warnings in ${files} files. They never fail; the thresholds are`,
    `the \`warn\` section of ${RULES_FILE}.`,
  ];
  for (const [kind, found] of byKind(warnings)) {
    if (kind === 'low-coverage' && !withCoverage) continue;
    out.push('', `${kind}, ${found.length}: ${titles[kind]}`, ...found.map((w) => `  ${item(w)}`));
  }
  out.push('', `Review them with the open lessons at the end of each stage: ${REVIEW}`, '');
  return out.join('\n');
}

/** The few lines `mwc check` ends with: the count of each kind and the worst warning of each. */
export function formatSummary(warnings: readonly Warning[]): string {
  if (warnings.length === 0) return 'Structure warnings: none (pnpm mwc structure --report)\n';
  const kinds = [...byKind(warnings)].filter(([, found]) => found.length > 0);
  const counts = kinds.map(([kind, found]) => `${found.length} ${kind}`).join(', ');
  const worst = kinds.map(([kind, found]) => `  ${kind.padEnd(14)}${found.map(item)[0]}`);
  return [
    `Structure warnings (never a failure): ${counts}. The worst of each:`,
    ...worst,
    'All of them: pnpm mwc structure --report',
    '',
  ].join('\n');
}

/** Reads the last coverage run's summary under `root`; undefined when there is none. */
export function coverageReader(root: string = REPO_ROOT, rules: StructureRules = STRUCTURE_RULES) {
  return (): string | undefined => {
    try {
      return readFileSync(join(root, rules.warn.coverageSummary), 'utf8');
    } catch {
      return undefined;
    }
  };
}

/** The warnings of the files `scan` lists, with the coverage summary's files when there is one. */
export function warningsOf(
  scan: ScanDeps,
  coverage: string | undefined,
  root: string = REPO_ROOT,
  rules: StructureRules = STRUCTURE_RULES,
) {
  const tree = repoTree(scan);
  const files = parseCoverage(coverage, root);
  return { warnings: structureWarnings(tree, files, rules), files: tree.paths.length, withCoverage: !!files };
}

/** `mwc structure --report`: the early warnings of the repository, in this process. Always exit 0. */
export function structureReport(
  io: MainIo,
  scan: ScanDeps = systemScanDeps(REPO_ROOT),
  readCoverage: () => string | undefined = coverageReader(),
): number {
  const { warnings, files, withCoverage } = warningsOf(scan, readCoverage());
  io.stdout(formatReport(warnings, files, withCoverage));
  return 0;
}
