import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

/** The typed client imports the server's types only; none of its runtime may reach the browser bundle. */
test('the production bundle holds no server code', () => {
  const assets = join(import.meta.dirname, '../dist/assets');
  const js = readdirSync(assets).filter((file) => file.endsWith('.js'));
  expect(js.length).toBeGreaterThan(0);
  for (const file of js) {
    const code = readFileSync(join(assets, file), 'utf8');
    for (const marker of ['pino', 'postgres', 'drizzle', 'pglite', 'node:fs', '@hono/node-server']) {
      expect(code, `${file} contains "${marker}"`).not.toContain(marker);
    }
  }
});
