import { checkDocs } from './docs.ts';
import { checkLayout, checkPackages } from './layout.ts';
import { checkModules } from './modules.ts';
import { checkPlacement } from './placement.ts';
import { STRUCTURE_RULES, type StructureRules } from './rules.ts';
import { checkSize } from './size.ts';
import type { RepoTree, Violation } from './tree.ts';

/** The structure step's rules in order, each a pure function of the tree (docs/structure.md). */
const CHECKS = [checkLayout, checkPackages, checkPlacement, checkSize, checkModules, checkDocs] as const;

/** Every broken structure rule in the tree. */
export function checkStructure(tree: RepoTree, rules: StructureRules = STRUCTURE_RULES): Violation[] {
  return CHECKS.flatMap((check) => check(tree, rules));
}

/** `path[:line]: [rule] message` per violation, then the hint; empty when there is none. */
export function formatViolations(
  violations: readonly Violation[],
  rules: StructureRules = STRUCTURE_RULES,
): string {
  if (violations.length === 0) return '';
  const lines = violations.map(
    (v) => `${v.path}${v.line === undefined ? '' : `:${v.line}`}: [${v.rule}] ${v.message}\n`,
  );
  return `${lines.join('')}${rules.hint}\n`;
}
