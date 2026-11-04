import type { StructureRules } from './rules.ts';
import { firstEntry, packageOf, type RepoTree, type Violation } from './tree.ts';

/**
 * Only known entries at the top level, and workspace packages only directly in the workspace groups
 * (`apps/<name>/`, `packages/<name>/`, `connectors/<name>/`): a package.json anywhere else, or a file
 * lying loose in a group folder, is refused. Each unknown entry is reported once, at its first file.
 */
export function checkLayout(tree: RepoTree, rules: StructureRules): Violation[] {
  const found: Violation[] = [];
  const reported = new Set<string>();
  const groups = rules.workspaceGroups.map((group) => `${group}/`).join(', ');
  for (const path of tree.paths) {
    const entry = firstEntry(path);
    if (!rules.topLevel.includes(entry)) {
      if (!reported.has(entry)) {
        reported.add(entry);
        found.push({
          path,
          rule: 'layout',
          message: `${entry} is not a known top-level entry; code goes in ${groups} (see the map)`,
        });
      }
      continue;
    }
    const segments = path.split('/');
    const group = segments[0] ?? '';
    if (rules.workspaceGroups.includes(group) && segments.length === 2) {
      found.push({ path, rule: 'layout', message: `only package folders go in ${group}/` });
      continue;
    }
    const where = packageOf(path, rules);
    const isManifest = segments.at(-1) === 'package.json';
    if (isManifest && path !== 'package.json' && where?.inner !== 'package.json') {
      found.push({
        path,
        rule: 'layout',
        message: `a workspace package lives directly in ${groups} (as <group>/<name>/package.json)`,
      });
    }
  }
  return found;
}

/** The workspace packages in the tree (`packages/db`, ...), sorted. */
export function workspacePackagesIn(tree: RepoTree, rules: StructureRules): string[] {
  const packages = new Set<string>();
  for (const path of tree.paths) {
    const where = packageOf(path, rules);
    if (where) packages.add(where.pkg);
  }
  return [...packages].sort();
}

/**
 * Every package has package.json, tsconfig.json and src/; a tested one also vitest.config.ts and at
 * least one test in test/; an untested one (apps/web, for now) neither; nothing else is at a package's
 * root but README.md, scripts/ and the package's own tool configuration (`packageExtras`).
 */
export function checkPackages(tree: RepoTree, rules: StructureRules): Violation[] {
  const found: Violation[] = [];
  const entries = new Map<string, Set<string>>();
  const tests = new Set<string>();
  for (const path of tree.paths) {
    const where = packageOf(path, rules);
    if (!where) continue;
    const seen = entries.get(where.pkg) ?? new Set<string>();
    seen.add(firstEntry(where.inner));
    entries.set(where.pkg, seen);
    if (where.inner.startsWith('test/') && rules.testFile.test(path)) tests.add(where.pkg);
  }
  for (const [pkg, seen] of entries) {
    const untested = rules.untested.includes(pkg);
    const required = [...rules.packageRequired, ...(untested ? [] : rules.packageTested)];
    for (const entry of required) {
      if (!seen.has(entry)) found.push({ path: `${pkg}/${entry}`, rule: 'package', message: 'missing' });
    }
    if (!untested && seen.has('test/') && !tests.has(pkg)) {
      found.push({ path: `${pkg}/test/`, rule: 'package', message: 'has no tests (*.test.ts)' });
    }
    const allowed = new Set([...required, ...rules.packageOptional, ...(rules.packageExtras[pkg] ?? [])]);
    for (const entry of [...seen].sort()) {
      if (allowed.has(entry)) continue;
      const why =
        untested && rules.packageTested.includes(entry)
          ? `${pkg} has no tests for now (docs/structure.md)`
          : `not part of a package (allowed: ${[...allowed].join(', ')})`;
      found.push({ path: `${pkg}/${entry}`, rule: 'package', message: why });
    }
  }
  return found;
}
