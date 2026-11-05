import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'cli',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The org commands' tests build the real API in beforeAll (createTestApp(): a PGlite cold start plus every
    // migration), which can take over Vitest's defaults when the whole workspace runs in parallel with coverage.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
