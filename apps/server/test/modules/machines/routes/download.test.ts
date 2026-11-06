import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RUNNER_BUNDLE_PATH,
  RUNNER_INSTALL_SCRIPT_PATH,
  RUNNER_SHA256_HEADER,
} from '@mwc/shared/runner-protocol';
import { brokenDb, createTestApp, getJson } from '@mwc/testkit';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RUNNER_BUNDLE } from '../../../../src/modules/machines/service/download.ts';
import { INSTALL_SCRIPT } from '../../../../src/modules/machines/service/install-script.ts';

/** A test app (no database needed: these routes read none) serving the bundle at `runnerBundle`. */
const appWith = (runnerBundle: string) => createTestApp({ db: brokenDb(), runnerBundle });

describe('GET /api/runner/runner.mjs', () => {
  it('serves the built runner to anyone, uncached, with its SHA-256', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'mwc-bundle-')), 'runner.mjs');
    writeFileSync(path, '// the runner\nconsole.log(1);\n');
    const t = await appWith(path);
    const res = await t.app.request(RUNNER_BUNDLE_PATH);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.text();
    expect(body).toBe('// the runner\nconsole.log(1);\n');
    expect(res.headers.get(RUNNER_SHA256_HEADER)).toBe(createHash('sha256').update(body).digest('hex'));
    // A rebuild is served at once.
    writeFileSync(path, '// rebuilt\n');
    expect(await (await t.app.request(RUNNER_BUNDLE_PATH)).text()).toBe('// rebuilt\n');
  });

  it('is a 404 runner_bundle_missing until the runner is built', async () => {
    const t = await appWith(join(tmpdir(), 'mwc-no-such-folder', 'runner.mjs'));
    expect(await getJson(t.app, RUNNER_BUNDLE_PATH)).toMatchObject({
      status: 404,
      body: {
        error: {
          code: 'runner_bundle_missing',
          message: expect.stringContaining('pnpm --filter @mwc/runner build'),
        },
      },
    });
  });

  it("serves the repository's apps/runner/dist/runner.mjs unless told otherwise", () => {
    const repo = fileURLToPath(new URL('../../../../../../', import.meta.url));
    expect(DEFAULT_RUNNER_BUNDLE).toBe(join(repo, 'apps/runner/dist/runner.mjs'));
  });
});

describe('GET /api/runner/install.sh', () => {
  it('serves the installer to anyone, uncached, as a shell script', async () => {
    const t = await appWith('/nowhere/runner.mjs');
    const res = await t.app.request(RUNNER_INSTALL_SCRIPT_PATH);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/x-shellscript; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toBe(INSTALL_SCRIPT);
  });

  it('is in no OpenAPI document (neither route is JSON)', async () => {
    const t = await appWith('/nowhere/runner.mjs');
    const doc = (await getJson(t.app, '/api/openapi.json')).body as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).not.toContain(RUNNER_INSTALL_SCRIPT_PATH);
    expect(Object.keys(doc.paths)).not.toContain(RUNNER_BUNDLE_PATH);
  });
});
