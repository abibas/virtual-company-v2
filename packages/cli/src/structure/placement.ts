import type { StructureRules } from './rules.ts';
import { packageOf, type RepoTree, type Violation } from './tree.ts';

/**
 * Tests only in test/: no test file under any src/ (or anywhere else outside a package's test/), and no
 * code in test/ that is not a test, except shared helpers in test/fixtures/.
 */
export function checkPlacement(tree: RepoTree, rules: StructureRules): Violation[] {
  const found: Violation[] = [];
  for (const path of tree.paths) {
    const where = packageOf(path, rules);
    const isTest = rules.testFile.test(path);
    const inTest = where?.inner.startsWith('test/') ?? false;
    if (isTest && !inTest) {
      const mirror = where?.inner.startsWith('src/')
        ? `${where.pkg}/test/${where.inner.slice(4)}`
        : undefined;
      found.push({
        path,
        rule: 'tests',
        message: mirror
          ? `a test under src/: move it to ${mirror} (test/ mirrors src/)`
          : "a test outside a package's test/: tests live in <package>/test/, mirroring src/",
      });
    } else if (where && inTest && !isTest && !where.inner.startsWith(rules.fixtures)) {
      found.push({
        path,
        rule: 'tests',
        message: `test/ holds tests only: move this helper to ${where.pkg}/${rules.fixtures} (or to src/ when other packages use it)`,
      });
    }
  }
  return found;
}
