import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'identity-clerk',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
