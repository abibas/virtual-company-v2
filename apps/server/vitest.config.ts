import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'server',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Some tests open a fresh database inside the test body: a PGlite cold start plus every migration can take
    // over Vitest's default 5 s when the whole workspace runs in parallel with coverage (S1.4).
    testTimeout: 20_000,
  },
});
