import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'db',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // These tests open fresh databases inside the test body: a PGlite cold start plus every migration takes
    // over Vitest's default 5 s when the whole workspace runs in parallel with coverage (S1.4).
    testTimeout: 20_000,
    // Most open theirs in a beforeAll: with 50 migrations (0049, 2026-11-15) that set-up passed Vitest's default 10 s
    // hook timeout when the whole workspace ran with coverage on a busy machine.
    hookTimeout: 30_000,
  },
});
