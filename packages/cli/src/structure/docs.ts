import type { StructureRules } from './rules.ts';
import type { RepoTree, Violation } from './tree.ts';
import { WARNING_KINDS, type WarningKind } from './warnings.ts';

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * True when `token` (a file, or a folder ending in `/`) is written in `text` as a name of its own: not
 * the tail of a longer name or path (with `afterPath`, a path before it is fine: `modules/<area>/repo.ts`
 * mentions `repo.ts`), and a file name not followed by more of a name.
 */
export function mentions(text: string, token: string, afterPath = false): boolean {
  const before = afterPath ? '(?<![\\w.-])' : '(?<![\\w./-])';
  const after = token.endsWith('/') ? '' : '(?![\\w-]|\\.\\w)';
  return new RegExp(`${before}${escapeRegExp(token)}${after}`).test(text);
}

/** The figures the warnings table of docs/structure.md states for each kind of warning. */
export function warnFigures(rules: StructureRules): Record<WarningKind, string[]> {
  const { warn } = rules;
  return {
    'near-limit': [`${Math.round(warn.nearLimit * 100)}%`],
    'long-function': [String(warn.functionLines)],
    'big-folder': [String(warn.folderEntries)],
    'fan-in': [String(warn.fanIn)],
    'low-coverage': [`${warn.coverage.lines}%`, `${warn.coverage.branches}%`],
  };
}

/** "Source files: at most 300 lines", "source files ≤ 300 lines". */
const sourceLimit = (lines: number) =>
  new RegExp(`source files?\\b[^\\n]{0,30}?(?:≤|at most)\\s*${lines}(?!\\d)`, 'i');
/** "Test files (everything under `test/`): at most 500 lines", "files in `test/` ≤ 500". */
const testLimit = (lines: number) =>
  new RegExp(`(?:test files?\\b|files in \`?test/\`?)[^\\n]{0,40}?(?:≤|at most)\\s*${lines}(?!\\d)`, 'i');

/** The 1-based line of a character offset. */
const lineAt = (text: string, offset: number) => text.slice(0, offset).split('\n').length;

/** Both documents state the line limits of `maxLines`. */
function limits(path: string, text: string, rules: StructureRules): Violation[] {
  const { source, test } = rules.maxLines;
  const found: Violation[] = [];
  if (!sourceLimit(source).test(text)) {
    found.push({
      path,
      rule: 'docs',
      message: `does not state the ${source}-line limit for source files (maxLines)`,
    });
  }
  if (!testLimit(test).test(text)) {
    found.push({
      path,
      rule: 'docs',
      message: `does not state the ${test}-line limit for test files (maxLines)`,
    });
  }
  return found;
}

/** docs/structure.md: the map, the workspace groups, the module table, the limits and the warnings table. */
function checkMap(path: string, text: string, rules: StructureRules): Violation[] {
  const found: Violation[] = [];
  const say = (message: string, line?: number) =>
    found.push({ path, ...(line === undefined ? {} : { line }), rule: 'docs', message });
  for (const entry of rules.topLevel) {
    if (!mentions(text, entry)) say(`does not mention the top-level entry ${entry} (topLevel)`);
  }
  for (const group of rules.workspaceGroups) {
    if (!text.includes(`\`${group}/*\``))
      say(`does not list the workspace group \`${group}/*\` (workspaceGroups)`);
  }
  const roles = rules.modules.files;
  for (const role of roles) {
    if (!new RegExp(`^\\s*\\|\\s*\`${escapeRegExp(role)}\`\\s*\\|`, 'm').test(text)) {
      say(`has no row for the module file \`${role}\` (modules.files)`);
    }
  }
  for (const row of text.matchAll(/^\s*\|\s*`([\w-]+\.ts)`\s*\|/gm)) {
    const role = row[1] ?? '';
    if (!roles.includes(role)) {
      say(`lists the module file \`${role}\`, which modules.files does not have`, lineAt(text, row.index));
    }
  }
  found.push(...limits(path, text, rules));
  const rows = text.split('\n').filter((line) => line.trimStart().startsWith('|'));
  const figures = warnFigures(rules);
  for (const kind of WARNING_KINDS) {
    const wanted = figures[kind];
    const has = (row: string, figure: string) =>
      new RegExp(`(?<![\\d.])${escapeRegExp(figure)}(?![\\d.]*\\d)`).test(row);
    if (!rows.some((row) => row.includes(`\`${kind}\``) && wanted.every((figure) => has(row, figure)))) {
      say(`has no warnings row for \`${kind}\` stating ${wanted.join(' and ')} (warn)`);
    }
  }
  return found;
}

/** The keep-structure skill: the module files it places code in, and the limits. */
function checkSkill(path: string, text: string, rules: StructureRules): Violation[] {
  const found: Violation[] = [];
  const roles = rules.modules.files;
  for (const role of roles) {
    if (!mentions(text, role, true)) {
      found.push({ path, rule: 'docs', message: `does not mention the module file ${role} (modules.files)` });
    }
  }
  for (const place of text.matchAll(/modules\/<area>\/([\w-]+\.ts)/g)) {
    const role = place[1] ?? '';
    if (roles.includes(role)) continue;
    found.push({
      path,
      line: lineAt(text, place.index),
      rule: 'docs',
      message: `places code in modules/<area>/${role}, which modules.files does not have`,
    });
  }
  found.push(...limits(path, text, rules));
  return found;
}

/**
 * The `docs` rule: docs/structure.md and the keep-structure skill say what rules.ts holds. The map
 * mentions every top-level entry, lists every workspace group (`apps/*`), has a row for each module file
 * and none for another, states the line limits, and has a warnings row per kind with its thresholds; the
 * skill mentions each module file, places code in no other, and states the limits. Each gap is one line.
 */
export function checkDocs(tree: RepoTree, rules: StructureRules): Violation[] {
  const found: Violation[] = [];
  for (const [path, check] of [
    [rules.docs.map, checkMap],
    [rules.docs.skill, checkSkill],
  ] as const) {
    const text = tree.paths.includes(path) ? tree.text(path) : undefined;
    if (text === undefined) {
      found.push({
        path,
        rule: 'docs',
        message: 'missing: it describes the rules of packages/cli/src/structure/rules.ts',
      });
      continue;
    }
    found.push(...check(path, text, rules));
  }
  return found;
}
