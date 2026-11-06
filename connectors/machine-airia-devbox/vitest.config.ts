import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'machine-airia-devbox',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
