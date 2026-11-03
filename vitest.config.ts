import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
      // Only barrels (re-exports) and the executable entries are excluded: the CLI's mwc.ts and the
      // server's main.ts (config, Postgres, listen, signals; its parts are tested one by one).
      exclude: ['**/*.test.ts', '**/src/index.ts', 'packages/cli/src/mwc.ts', 'apps/server/src/main.ts'],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 70,
      },
      reporter: ['text', 'lcov'],
    },
  },
});
