import type { StructureRules } from './rules.ts';
import { lineCount, matches, packageOf, type RepoTree, type Violation } from './tree.ts';

/** True when the size limits do not apply: generated files and documentation. */
export function sizeExempt(path: string, rules: StructureRules): boolean {
  if (rules.generated.some((entry) => matches(path, entry))) return true;
  return rules.unlimitedExtensions.some((extension) => path.endsWith(extension));
}

/** Source files at most `maxLines.source` lines, files in a package's test/ at most `maxLines.test`. */
export function checkSize(tree: RepoTree, rules: StructureRules): Violation[] {
  const found: Violation[] = [];
  for (const path of tree.paths) {
    if (sizeExempt(path, rules)) continue;
    const text = tree.text(path);
    if (text === undefined) continue;
    const kind = packageOf(path, rules)?.inner.startsWith('test/') ? 'test' : 'source';
    const limit = rules.maxLines[kind];
    const lines = lineCount(text);
    if (lines <= limit) continue;
    found.push({
      path,
      line: limit + 1,
      rule: 'size',
      message: `${lines} lines, over the ${limit}-line limit for ${kind} files: split it by responsibility`,
    });
  }
  return found;
}
