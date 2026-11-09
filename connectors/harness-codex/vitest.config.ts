import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'harness-codex',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
