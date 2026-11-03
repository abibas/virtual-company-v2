import { PORTS } from '@mwc/shared/ports';
import { defineConfig } from '@playwright/test';

/**
 * The web e2e smoke: the production build (`vite build` first) served by `vite preview` on 9955,
 * proxying to the API on an in-memory PGlite on 9957. Uses the installed Google Chrome
 * (channel 'chrome'), so no browser is downloaded. Runs in `pnpm mwc check --full` and `pnpm e2e`.
 */
const apiUrl = `http://127.0.0.1:${PORTS.e2eApi}`;
const webUrl = `http://127.0.0.1:${PORTS.webPreview}`;

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: [['list']],
  outputDir: '../../.data/playwright/results',
  use: {
    baseURL: webUrl,
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node ../server/src/dev-memory.ts',
      url: `${apiUrl}/readyz`,
      env: { MWC_PORT: String(PORTS.e2eApi), NODE_ENV: 'test', MWC_LOG_LEVEL: 'warn' },
      reuseExistingServer: false,
      timeout: 30_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
    {
      command: 'node node_modules/vite/bin/vite.js preview',
      url: webUrl,
      env: { MWC_API_URL: apiUrl },
      reuseExistingServer: false,
      timeout: 30_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
  ],
});
