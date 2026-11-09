/**
 * The rules of docs/structure.md as data: every limit and allow-list the structure step of `mwc check`
 * uses is here, and the thresholds of its early warnings (`warn`), so changing a rule means changing this
 * object, its tests, docs/structure.md and the keep-structure skill together (the `docs` rule checks that
 * they agree). Folders end in `/`. Coverage floors are not here: Vitest enforces them (the root
 * vitest.config.ts, `thresholds.perFile`).
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
  /** Early warnings (`mwc structure --report`, summed up at the end of `mwc check`); they never fail. */
  readonly warn: {
    /** A limited file above this share of its line limit (`near-limit`). */
    readonly nearLimit: number;
    /** A named function longer than this many lines, first to last (`long-function`, structure/functions.ts). */
    readonly functionLines: number;
    /** A folder with more direct entries, files and folders, than this (`big-folder`). */
    readonly folderEntries: number;
    /**
     * A limit of their own for the folders that grow by design (`*` is one path segment); a test folder that
     * mirrors a source folder (`<pkg>/test/<path>/` for `<pkg>/src/<path>/`) gets that source folder's limit.
     */
    readonly folderEntriesFor: Readonly<Record<string, number>>;
    /**
     * A file that at least this many other files of its package import, outside test/ (`fan-in`). Type-only
     * imports are not counted; the importers inside one `fanInGroups` folder count as one.
     */
    readonly fanIn: number;
    /** Folders whose files count as one importer for `fan-in` (`*` is one path segment): a server module. */
    readonly fanInGroups: readonly string[];
    /** Files or folders meant to be imported everywhere, never listed by `fan-in`. */
    readonly fanInExempt: readonly string[];
    /** A file under either percentage in the last coverage run (`low-coverage`). */
    readonly coverage: { readonly lines: number; readonly branches: number };
    /** Where that run writes its summary: the json-summary reporter of the root vitest.config.ts. */
    readonly coverageSummary: string;
  };
  /** The documents that describe these rules; the `docs` rule fails when they fall behind. */
  readonly docs: { readonly map: string; readonly skill: string };
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
  warn: {
    nearLimit: 0.8,
    functionLines: 60,
    folderEntries: 12,
    folderEntriesFor: {
      'apps/web/src/components/*/': 20,
      'apps/web/src/api/': 20,
      'packages/db/src/schema/': 20,
      'packages/shared/src/': 20,
      'packages/shared/test/': 20,
    },
    fanIn: 8,
    fanInGroups: ['apps/server/src/modules/*/'],
    fanInExempt: ['apps/web/src/components/', 'apps/web/src/api/', 'apps/web/src/app/'],
    coverage: { lines: 95, branches: 90 },
    coverageSummary: '.cache/coverage/coverage-summary.json',
  },
  docs: { map: 'docs/structure.md', skill: '.claude/skills/keep-structure/SKILL.md' },
  hint: 'The rules are in docs/structure.md; see .claude/skills/keep-structure (load it before adding, moving or splitting files).',
};
