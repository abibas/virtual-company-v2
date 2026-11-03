import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
      // Only barrels (re-exports) and the CLI's executable entry are excluded.
      exclude: ['**/*.test.ts', '**/src/index.ts', 'packages/cli/src/mwc.ts'],
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
