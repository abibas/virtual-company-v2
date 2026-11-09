import { dirname, posix } from 'node:path';
import { functionSpans } from './functions.ts';
import { importsOf } from './modules.ts';
import { STRUCTURE_RULES, type StructureRules } from './rules.ts';
import { measure } from './size.ts';
import { matches, packageOf, type RepoTree } from './tree.ts';

/** The early warnings, in the order the report lists them (docs/structure.md, "Early warnings"). */
export const WARNING_KINDS = ['near-limit', 'long-function', 'big-folder', 'fan-in', 'low-coverage'] as const;
export type WarningKind = (typeof WARNING_KINDS)[number];

/** A hot spot: where (a file or folder, and a line when there is one) and what. Never a failure. */
export interface Warning {
  readonly kind: WarningKind;
  readonly path: string;
  readonly line?: number;
  readonly message: string;
}

/** One file's coverage in the last coverage run, in percent. */
export interface FileCoverage {
  readonly path: string;
  readonly lines: number;
  readonly branches: number;
}

/** A warning with how bad it is, for sorting each kind worst first. */
type Weighed = Warning & { readonly weight: number };

/** Code whose functions and imports the report reads. */
const CODE = /\.[cm]?[jt]sx?$/;

interface Metric {
  readonly total: number;
  readonly pct: number;
}

function isMetric(value: unknown): value is Metric {
  const metric = value as Partial<Metric> | undefined;
  return typeof metric?.total === 'number' && typeof metric.pct === 'number';
}

/**
 * The files of a json-summary coverage report (Vitest's `coverage-summary.json`) with their line and
 * branch percentages, paths relative to `root`; undefined without a report or when it is not JSON. Files
 * without lines to measure (type-only files) are left out; a file without branches has all of them.
 */
export function parseCoverage(json: string | undefined, root: string): FileCoverage[] | undefined {
  if (json === undefined) return undefined;
  let summary: unknown;
  try {
    summary = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof summary !== 'object' || summary === null) return undefined;
  const files: FileCoverage[] = [];
  for (const [file, value] of Object.entries(summary)) {
    const { lines, branches } = (value ?? {}) as { lines?: unknown; branches?: unknown };
    if (file === 'total' || !isMetric(lines) || lines.total === 0) continue;
    const path = file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;
    const branchPct = isMetric(branches) && branches.total > 0 ? branches.pct : 100;
    files.push({ path, lines: lines.pct, branches: branchPct });
  }
  return files;
}

/** The folders of a path, each with the entry of the path directly in it (`a/` holds `b/` for `a/b/c`). */
function folderEntries(path: string): [folder: string, entry: string][] {
  const segments = path.split('/');
  return segments
    .slice(1)
    .map((segment, index) => [
      `${segments.slice(0, index + 1).join('/')}/`,
      index === segments.length - 2 ? segment : `${segment}/`,
    ]);
}

/**
 * `import type … from`, `export type … from`, or a brace list (`import { type A } from`): the names, when
 * there is a list, and the specifier. A list counts as type-only when each of its names is `type`.
 */
const TYPE_IMPORT =
  /\b(?:import|export)\s+(?:type\s+(?!from\b)[^'";=]*?|\{([^}]*)\})\s*from\s*['"]([^'"]+)['"]/g;

/** How many of a text's imports of each specifier are type-only (erased when it runs). */
function typeOnlyImports(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [, list, specifier = ''] of text.matchAll(TYPE_IMPORT)) {
    const names = list
      ?.split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    if (names && (names.length === 0 || !names.every((name) => /^type\s/.test(name)))) continue;
    counts.set(specifier, (counts.get(specifier) ?? 0) + 1);
  }
  return counts;
}

/** The files of its own package that `path` imports by relative path for its values (outside test/ only). */
function packageImports(path: string, text: string, known: ReadonlySet<string>, rules: StructureRules) {
  const where = packageOf(path, rules);
  if (!where || where.inner.startsWith('test/')) return [];
  const typeOnly = typeOnlyImports(text);
  const targets = new Set<string>();
  for (const { specifier } of importsOf(text)) {
    const types = typeOnly.get(specifier) ?? 0;
    if (types > 0) typeOnly.set(specifier, types - 1);
    if (types > 0 || !specifier.startsWith('.')) continue;
    const target = posix.normalize(posix.join(dirname(path), specifier));
    if (target !== path && known.has(target) && target.startsWith(`${where.pkg}/`)) targets.add(target);
  }
  return [...targets];
}

/** A pattern whose `*` is one path segment, matching the start of a path, or with `whole` all of it. */
function glob(pattern: string, whole = false): RegExp {
  const parts = pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${parts.join('[^/]+')}${whole ? '$' : ''}`);
}

/** The source folder a test folder mirrors (`<pkg>/test/<path>/` → `<pkg>/src/<path>/`), or '' for none. */
function mirroredSource(folder: string, rules: StructureRules): string {
  const where = packageOf(folder, rules);
  if (!where?.inner.startsWith('test/') || where.inner === 'test/') return '';
  return `${where.pkg}/src/${where.inner.slice('test/'.length)}`;
}

/** Who imports, for `fan-in`: the folder of the `fanInGroups` pattern the file is in, or the file. */
function importerOf(path: string, groups: readonly RegExp[]): string {
  for (const group of groups) {
    const found = group.exec(path);
    if (found) return found[0];
  }
  return path;
}

/** A limited file above `warn.nearLimit` of its line limit. */
function nearLimit(path: string, size: ReturnType<typeof measure>, rules: StructureRules): Weighed[] {
  if (size === undefined || size.lines <= size.limit * rules.warn.nearLimit) return [];
  const share = size.lines / size.limit;
  const message = `${size.lines} of ${size.limit} lines (${Math.round(share * 100)}%)`;
  return [{ kind: 'near-limit', path, message, weight: share }];
}

/** Named functions over `warn.functionLines` lines. */
function longFunctions(path: string, text: string, rules: StructureRules): Weighed[] {
  return functionSpans(text)
    .map((span) => ({ ...span, lines: span.end - span.line + 1 }))
    .filter((span) => span.lines > rules.warn.functionLines)
    .map((span) => ({
      kind: 'long-function',
      path,
      line: span.line,
      message: `${span.name}, ${span.lines} lines`,
      weight: span.lines,
    }));
}

/** Files under either coverage percentage of `warn.coverage`, weighed by how far under the bar they are. */
export function lowCoverage(files: readonly FileCoverage[], rules: StructureRules = STRUCTURE_RULES) {
  const bar = rules.warn.coverage;
  return files
    .filter((file) => file.lines < bar.lines || file.branches < bar.branches)
    .map(
      (file): Weighed => ({
        kind: 'low-coverage',
        path: file.path,
        message: `${file.lines}% lines, ${file.branches}% branches`,
        weight: Math.max(bar.lines - file.lines, bar.branches - file.branches),
      }),
    );
}

/**
 * Every early warning of the tree, in one pass over its files (each read once, in this process):
 * limited files near their limit, long named functions, folders with many entries, files many files of
 * their package import (for their values; a server module counts once, the files meant to be imported
 * everywhere are left out), and, with the last coverage run's files, the weakest-covered ones. Each kind
 * is listed worst first.
 */
export function structureWarnings(
  tree: RepoTree,
  coverage: readonly FileCoverage[] | undefined,
  rules: StructureRules = STRUCTURE_RULES,
): Warning[] {
  const found: Weighed[] = [];
  const entries = new Map<string, Set<string>>();
  const importers = new Map<string, Set<string>>();
  const known = new Set(tree.paths);
  const generated = rules.generated.filter((entry) => entry.endsWith('/'));
  const groups = rules.warn.fanInGroups.map((pattern) => glob(pattern));
  const limits = Object.entries(rules.warn.folderEntriesFor).map(([pattern, limit]) => ({
    folder: glob(pattern, true),
    limit,
  }));
  for (const path of tree.paths) {
    for (const [folder, entry] of folderEntries(path)) {
      if (generated.some((skip) => matches(folder, skip))) break;
      entries.set(folder, (entries.get(folder) ?? new Set()).add(entry));
    }
    const size = measure(tree, path, rules);
    found.push(...nearLimit(path, size, rules));
    const text = size && CODE.test(path) ? tree.text(path) : undefined;
    if (text === undefined) continue;
    found.push(...longFunctions(path, text, rules));
    const importer = importerOf(path, groups);
    for (const target of packageImports(path, text, known, rules)) {
      importers.set(target, (importers.get(target) ?? new Set()).add(importer));
    }
  }
  const ownLimit = (folder: string) => limits.find(({ folder: own }) => own.test(folder))?.limit;
  for (const [folder, inside] of entries) {
    const limit = ownLimit(folder) ?? ownLimit(mirroredSource(folder, rules)) ?? rules.warn.folderEntries;
    if (inside.size <= limit) continue;
    found.push({ kind: 'big-folder', path: folder, message: `${inside.size} entries`, weight: inside.size });
  }
  for (const [target, from] of importers) {
    if (from.size < rules.warn.fanIn || rules.warn.fanInExempt.some((entry) => matches(target, entry)))
      continue;
    found.push({
      kind: 'fan-in',
      path: target,
      message: `imported by ${from.size} files`,
      weight: from.size,
    });
  }
  found.push(...lowCoverage(coverage ?? [], rules));
  const order = (kind: WarningKind) => WARNING_KINDS.indexOf(kind);
  return found
    .sort((a, b) => order(a.kind) - order(b.kind) || b.weight - a.weight || a.path.localeCompare(b.path))
    .map(({ weight: _, ...warning }) => warning);
}
