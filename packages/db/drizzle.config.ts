import { defineConfig } from 'drizzle-kit';

// Paths are relative to packages/db (pnpm runs package scripts there).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
});
