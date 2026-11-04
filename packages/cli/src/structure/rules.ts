/**
 * The rules of docs/structure.md as data: every limit and allow-list the structure step of `mwc check`
 * uses is here, so changing a rule means changing this object (and the doc). Folders end in `/`.
 * Coverage floors are not here: Vitest enforces them (the root vitest.config.ts, `thresholds.perFile`).
 */
export interface StructureRules {
  /** Line limits: every limited file outside a package's test/, and everything inside it. */
  readonly maxLines: { readonly source: number; readonly test: number };
  /** Written by tools, not by us, so not limited: files, or folders ending in `/`. */
  readonly generated: readonly string[];
  /** Documentation, not limited. */
  readonly unlimitedExtensions: readonly string[];
  /** The only entries allowed at the top level of the repository. */
  readonly topLevel: readonly string[];
  /** Where workspace packages live: `<group>/<name>/`. */
  readonly workspaceGroups: readonly string[];
  /** What every package has. */
  readonly packageRequired: readonly string[];
  /** What every tested package has besides that (and at least one test in test/). */
  readonly packageTested: readonly string[];
  /** What any package may have. */
  readonly packageOptional: readonly string[];
  /** More entries one package may have: its tool configuration. */
  readonly packageExtras: Readonly<Record<string, readonly string[]>>;
  /** Packages without tests for now: no test/, no vitest.config.ts. */
  readonly untested: readonly string[];
  /** Where a package's shared test helpers live, inside the package. */
  readonly fixtures: string;
  /** A test file's name. */
  readonly testFile: RegExp;
  /** The server's modules, and the files a module may have (each may grow into a same-named folder). */
  readonly modules: { readonly root: string; readonly files: readonly string[] };
  /** Said after every failure. */
  readonly hint: string;
}

export const STRUCTURE_RULES: StructureRules = {
  maxLines: { source: 300, test: 500 },
  generated: ['pnpm-lock.yaml', 'packages/db/migrations/', 'docs/schema.md'],
  unlimitedExtensions: ['.md'],
  topLevel: [
    'apps/',
    'packages/',
    'connectors/',
    'deploy/',
    'docs/',
    '.githooks/',
    '.claude/',
    '.vscode/',
    '.dockerignore',
    '.env.example',
    '.gitignore',
    '.nvmrc',
    'biome.json',
    'CLAUDE.md',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'README.md',
    'tsconfig.base.json',
    'vitest.config.ts',
  ],
  workspaceGroups: ['apps', 'packages', 'connectors'],
  packageRequired: ['package.json', 'tsconfig.json', 'src/'],
  packageTested: ['vitest.config.ts', 'test/'],
  packageOptional: ['README.md', 'scripts/'],
  packageExtras: {
    'apps/web': ['index.html', 'vite.config.ts'],
    'packages/db': ['drizzle.config.ts', 'migrations/'],
  },
  untested: ['apps/web'],
  fixtures: 'test/fixtures/',
  testFile: /\.(test|spec)\.tsx?$/,
  modules: {
    root: 'apps/server/src/modules/',
    files: ['routes.ts', 'service.ts', 'repo.ts', 'schemas.ts', 'rules.ts', 'index.ts'],
  },
  hint: 'The rules are in docs/structure.md; load the keep-structure skill before adding, moving or splitting files.',
};
