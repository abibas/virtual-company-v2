import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'github',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
