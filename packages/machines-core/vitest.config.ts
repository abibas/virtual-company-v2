import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'machines-core',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
