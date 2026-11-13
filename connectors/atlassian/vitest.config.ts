import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'atlassian',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
