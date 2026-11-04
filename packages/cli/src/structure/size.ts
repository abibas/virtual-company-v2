import type { StructureRules } from './rules.ts';
import { lineCount, matches, packageOf, type RepoTree, type Violation } from './tree.ts';

/** True when the size limits do not apply: generated files and documentation. */
export function sizeExempt(path: string, rules: StructureRules): boolean {
  if (rules.generated.some((entry) => matches(path, entry))) return true;
  return rules.unlimitedExtensions.some((extension) => path.endsWith(extension));
}

/** A limited file's kind, line count and limit; undefined when it is exempt, binary or gone. */
export function measure(
  tree: RepoTree,
  path: string,
  rules: StructureRules,
): { kind: 'source' | 'test'; lines: number; limit: number } | undefined {
  if (sizeExempt(path, rules)) return undefined;
  const text = tree.text(path);
  if (text === undefined) return undefined;
  const kind = packageOf(path, rules)?.inner.startsWith('test/') ? 'test' : 'source';
  return { kind, lines: lineCount(text), limit: rules.maxLines[kind] };
}

/** Source files at most `maxLines.source` lines, files in a package's test/ at most `maxLines.test`. */
export function checkSize(tree: RepoTree, rules: StructureRules): Violation[] {
  const found: Violation[] = [];
  for (const path of tree.paths) {
    const size = measure(tree, path, rules);
    if (size === undefined || size.lines <= size.limit) continue;
    found.push({
      path,
      line: size.limit + 1,
      rule: 'size',
      message: `${size.lines} lines, over the ${size.limit}-line limit for ${size.kind} files: split it by responsibility`,
    });
  }
  return found;
}
