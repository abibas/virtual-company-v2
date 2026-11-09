import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'harness-claude-code',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
