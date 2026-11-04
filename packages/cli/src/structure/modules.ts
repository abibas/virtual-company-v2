import { dirname, posix } from 'node:path';
import type { StructureRules } from './rules.ts';
import type { RepoTree, Violation } from './tree.ts';

/** `from '…'`, `import('…')` and a bare `import '…'`: the specifiers one line imports. */
const IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/g;

/** Every import specifier in a source text, with its 1-based line. */
export function importsOf(text: string): { line: number; specifier: string }[] {
  const found: { line: number; specifier: string }[] = [];
  text.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(IMPORT)) found.push({ line: index + 1, specifier: match[1] ?? '' });
  });
  return found;
}

/** The package names of the connectors (`connectors/<name>/package.json`). */
export function connectorNames(tree: RepoTree): Set<string> {
  const names = new Set<string>();
  for (const path of tree.paths) {
    if (!/^connectors\/[^/]+\/package\.json$/.test(path)) continue;
    try {
      const { name } = JSON.parse(tree.text(path) ?? '{}') as { name?: unknown };
      if (typeof name === 'string') names.add(name);
    } catch {
      // A broken package.json fails its typecheck and install; nothing to say here.
    }
  }
  return names;
}

/**
 * Server modules: directly in `modules/<area>/` only the role files (routes.ts, service.ts, repo.ts,
 * schemas.ts, rules.ts, index.ts) or a folder named after a role (`service/`); no module imports
 * another module's repo (it calls that module's service); no module imports a connector (modules
 * depend on the port; connectors are wired in app.ts).
 */
export function checkModules(tree: RepoTree, rules: StructureRules): Violation[] {
  const { root, files } = rules.modules;
  const folders = files.filter((file) => file !== 'index.ts').map((file) => file.replace(/\.ts$/, ''));
  const connectors = connectorNames(tree);
  const found: Violation[] = [];
  for (const path of tree.paths) {
    if (!path.startsWith(root)) continue;
    const [area, entry, ...deeper] = path.slice(root.length).split('/');
    if (entry === undefined) {
      found.push({ path, rule: 'modules', message: `${root} holds one folder per business area, no files` });
      continue;
    }
    if (deeper.length === 0 ? !files.includes(entry) : !folders.includes(entry)) {
      found.push({
        path,
        rule: 'modules',
        message: `a module has only ${files.join(', ')} (or a same-named folder, e.g. service/)`,
      });
    }
    if (!/\.tsx?$/.test(path)) continue;
    for (const { line, specifier } of importsOf(tree.text(path) ?? '')) {
      if (connectors.has(specifier)) {
        found.push({
          path,
          line,
          rule: 'modules',
          message: `imports the connector ${specifier}: modules use its port (packages/*-core); wire the connector in app.ts`,
        });
        continue;
      }
      if (!specifier.startsWith('.')) continue;
      const target = posix.normalize(posix.join(dirname(path), specifier));
      if (!target.startsWith(root)) continue;
      const [otherArea, otherEntry] = target.slice(root.length).split('/');
      if (otherArea !== area && (otherEntry === 'repo.ts' || otherEntry === 'repo')) {
        found.push({
          path,
          line,
          rule: 'modules',
          message: `imports another module's repo (${root}${otherArea}/${otherEntry}): call its service instead`,
        });
      }
    }
  }
  return found;
}
