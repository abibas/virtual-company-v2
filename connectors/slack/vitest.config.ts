import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'slack',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
