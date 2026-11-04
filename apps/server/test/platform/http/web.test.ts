import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brokenDb, createTestApp, LEVEL, type TestApp } from '@mwc/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let dist: string;
let t: TestApp;

beforeAll(async () => {
  dist = mkdtempSync(join(tmpdir(), 'mwc-web-dist-'));
  mkdirSync(join(dist, 'assets'));
  writeFileSync(
    join(dist, 'index.html'),
    '<!doctype html><title>Most Wanted Corp</title><div id="root"></div>',
  );
  writeFileSync(join(dist, 'assets/index-abc123.js'), 'console.log("app")');
  writeFileSync(join(dist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  t = await createTestApp({ db: brokenDb(), webDist: dist });
});
afterAll(() => {
  rmSync(dist, { recursive: true, force: true });
});

describe('the built web UI (webDist)', () => {
  it('serves index.html for / and revalidates it', async () => {
    const res = await t.app.request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(await res.text()).toContain('<title>Most Wanted Corp</title>');
  });

  it('serves hashed assets with a year-long immutable cache, and other files revalidated', async () => {
    const js = await t.app.request('/assets/index-abc123.js');
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toContain('javascript');
    expect(js.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await js.text()).toBe('console.log("app")');
    const icon = await t.app.request('/favicon.svg');
    expect(icon.headers.get('cache-control')).toBe('no-cache');
  });

  it('answers client-side routes with index.html, but missing files with the JSON 404', async () => {
    const route = await t.app.request('/org/chart');
    expect(route.status).toBe(200);
    expect(await route.text()).toContain('<div id="root">');
    const missing = await t.app.request('/assets/missing.js');
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe('not_found');
  });

  it('keeps the API first: routes answer as before and unknown /api paths stay JSON 404s', async () => {
    expect((await t.app.request('/healthz')).headers.get('content-type')).toContain('application/json');
    for (const path of ['/api', '/api/nope', '/api/companies/x/nope']) {
      const res = await t.app.request(path);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toContain('application/json');
    }
  });

  it('refuses paths that climb out of the folder', async () => {
    for (const path of ['/../package.json', '/assets/../../etc/passwd', '/%2e%2e/package.json']) {
      const res = await t.app.request(path);
      expect(res.headers.get('content-type') ?? '').not.toContain('javascript');
      expect(await res.text()).not.toContain('"name"');
    }
  });

  it('serves nothing for / without webDist', async () => {
    const plain = await createTestApp({ db: brokenDb() });
    expect((await plain.app.request('/')).status).toBe(404);
  });

  it('warns at startup when the folder has no index.html, and falls through to the JSON 404', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'mwc-web-empty-'));
    try {
      const bare = await createTestApp({ db: brokenDb(), webDist: empty });
      expect(bare.logs.find((line) => line.msg.includes('no index.html'))?.level).toBe(LEVEL.warn);
      expect((await bare.app.request('/somewhere')).status).toBe(404);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
