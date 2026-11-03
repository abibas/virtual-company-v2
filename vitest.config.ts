import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // apps/web has no unit tests (house rule: no UI unit tests); its Playwright smoke runs in --full.
    projects: ['packages/*', 'apps/*', '!apps/web'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
      // Excluded: barrels (re-exports), the executable entries (the CLI's mwc.ts; the server's main.ts
      // and dev-memory.ts: config, database, listen, signals, whose parts are tested one by one) and
      // the web UI, which the Playwright smoke covers instead of unit tests.
      exclude: [
        '**/*.test.ts',
        '**/src/index.ts',
        'packages/cli/src/mwc.ts',
        'apps/server/src/main.ts',
        'apps/server/src/dev-memory.ts',
        'apps/web/**',
      ],
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
