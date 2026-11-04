import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'db',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // These tests open fresh databases inside the test body: a PGlite cold start plus every migration takes
    // over Vitest's default 5 s when the whole workspace runs in parallel with coverage (S1.4).
    testTimeout: 20_000,
  },
});
