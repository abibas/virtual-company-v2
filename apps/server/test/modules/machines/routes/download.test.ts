import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RUNNER_BUNDLE_PATH,
  RUNNER_INSTALL_SCRIPT_PATH,
  RUNNER_PTY_PATH,
  RUNNER_SHA256_HEADER,
} from '@mwc/shared/runner-protocol';
import { brokenDb, createTestApp, getJson } from '@mwc/testkit';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RUNNER_BUNDLE,
  servedBuild,
} from '../../../../src/modules/machines/service/runner/download.ts';
import { INSTALL_SCRIPT } from '../../../../src/modules/machines/service/runner/install-script.ts';

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

describe('GET /api/runner/pty/<target>.tgz', () => {
  it("serves a system's PTY archive from beside the bundle, uncached, with its SHA-256", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mwc-bundle-'));
    mkdirSync(join(dir, 'pty'));
    const archive = Buffer.from([0x1f, 0x8b, 8, 0, 1, 2, 3]);
    writeFileSync(join(dir, 'pty', 'linux-x64.tgz'), archive);
    const t = await appWith(join(dir, 'runner.mjs'));
    const res = await t.app.request(`${RUNNER_PTY_PATH}/linux-x64.tgz`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/gzip');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(Buffer.from(await res.arrayBuffer()).equals(archive)).toBe(true);
    expect(res.headers.get(RUNNER_SHA256_HEADER)).toBe(createHash('sha256').update(archive).digest('hex'));
  });

  it('is a 404 runner_pty_missing for a system none is built for, another name, or before the build', async () => {
    const t = await appWith(join(tmpdir(), 'mwc-no-such-folder', 'runner.mjs'));
    for (const file of ['linux-x64.tgz', 'win32-x64.tgz', 'linux-x64', '..%2Frunner.mjs']) {
      expect(await getJson(t.app, `${RUNNER_PTY_PATH}/${file}`)).toMatchObject({
        status: 404,
        body: { error: { code: 'runner_pty_missing', message: expect.stringContaining('darwin-arm64') } },
      });
    }
  });
});

describe('the build this server hands out', () => {
  it("is the bundle's SHA-256, hashed again only after a rebuild, and null until it is built", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mwc-build-'));
    const path = join(dir, 'runner.mjs');
    expect(await servedBuild(path)).toBeNull();
    writeFileSync(path, '// one\n');
    const one = createHash('sha256').update('// one\n').digest('hex');
    expect(await servedBuild(path)).toBe(one);
    expect(await servedBuild(path)).toBe(one);
    writeFileSync(path, '// two, longer\n');
    expect(await servedBuild(path)).toBe(createHash('sha256').update('// two, longer\n').digest('hex'));
    // A folder where the bundle should be is no build.
    mkdirSync(join(dir, 'folder.mjs'));
    expect(await servedBuild(join(dir, 'folder.mjs'))).toBeNull();
  });
});
