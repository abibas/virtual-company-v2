import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isReservedSlug } from '@mwc/shared/slugs';
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

/** The web's route table: its own pages (`AppRoutes.tsx`) and the development gallery (`App.tsx`). */
const WEB_ROUTE_FILES = ['AppRoutes.tsx', 'App.tsx'];
const webApp = new URL('../../../../web/src/app/', import.meta.url);

/** The first segment of every absolute path written in the code of a file (comments left out). */
function firstSegments(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return [...code.matchAll(/['"`]\/([a-z0-9][^/'"`?#*\s]*)/gi)].map((match) => match[1] ?? '');
}

describe('company addresses at /<slug>', () => {
  it('answers a company’s deep links with index.html, while the API and the probes keep answering', async () => {
    for (const path of [
      '/most-wanted',
      '/most-wanted/agents',
      '/most-wanted/agents/slop-box',
      '/c/acme/members',
    ]) {
      const res = await t.app.request(path);
      expect(res.status, path).toBe(200);
      expect(await res.text()).toContain('<div id="root">');
    }
    for (const path of ['/healthz', '/readyz', '/api/openapi.json']) {
      expect((await t.app.request(path)).headers.get('content-type'), path).toContain('application/json');
    }
  });

  it('never lets a company slug shadow a path the server answers or a page of the web', async () => {
    const doc = (await (await t.app.request('/api/openapi.json')).json()) as {
      paths: Record<string, unknown>;
    };
    const server = Object.keys(doc.paths).map((path) => path.split('/')[1] ?? '');
    expect(new Set(server)).toEqual(new Set(['api', 'healthz', 'readyz']));
    const web = WEB_ROUTE_FILES.flatMap((file) => firstSegments(readFileSync(new URL(file, webApp), 'utf8')));
    expect(web).toEqual(
      expect.arrayContaining(['sign-in', 'sign-up', 'accept-invitation', 'companies', 'c', 'design']),
    );
    for (const segment of [...server, ...web]) expect(isReservedSlug(segment), segment).toBe(true);
  });
});
