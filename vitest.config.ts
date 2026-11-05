import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every workspace package with tests; apps/web has none for now (docs/structure.md). A group without
    // packages yet (connectors/) simply matches nothing.
    projects: ['packages/*', 'connectors/*', 'apps/*', '!apps/web'],
    coverage: {
      provider: 'v8',
      // Tests live in test/, so only code is measured.
      include: ['packages/*/src/**/*.ts', 'connectors/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
      // Excluded: barrels (re-exports) and the executable entries (the CLI's mwc.ts, the server's and the MCP
      // server's main.ts; scripts/ are outside src/), whose parts are tested one by one, and the web UI (no
      // frontend tests for now).
      exclude: [
        '**/src/index.ts',
        'packages/cli/src/mwc.ts',
        'apps/server/src/main.ts',
        'packages/mcp/src/main.ts',
        'apps/web/**',
      ],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 85,
        // And every file on its own (docs/structure.md, "Coverage").
        perFile: { lines: 85, branches: 75 },
      },
      reportsDirectory: '.cache/coverage',
      reporter: ['text', 'lcov', 'json-summary'],
    },
  },
});
