import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'tools-core',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
