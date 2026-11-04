import { brokenDb, createTestApp, TEST_VERSION, type TestApp } from '@mwc/testkit';
import { beforeAll, describe, expect, it } from 'vitest';

let t: TestApp;

beforeAll(async () => {
  // The docs never touch the database.
  t = await createTestApp({ db: brokenDb() });
});

describe('OpenAPI and docs', () => {
  it('serves an OpenAPI 3.1 document that lists the routes', async () => {
    const res = await t.app.request('/api/openapi.json');
    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      openapi: string;
      info: { version: string };
      paths: Record<string, { get?: { responses: Record<string, unknown> } }>;
    };
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.version).toBe(TEST_VERSION);
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/healthz',
        '/readyz',
        '/api/version',
        '/api/me',
        '/api/companies',
        '/api/companies/{companyId}',
      ]),
    );
    expect(Object.keys(doc.paths['/readyz']?.get?.responses ?? {})).toEqual(['200', '503']);
  });

  it('documents the bearer credential and the routes that need it', async () => {
    const doc = (await (await t.app.request('/api/openapi.json')).json()) as {
      components: { securitySchemes: Record<string, { type: string; scheme: string }> };
      paths: Record<string, { get?: { security?: unknown; responses: Record<string, unknown> } }>;
    };
    expect(doc.components.securitySchemes.bearer).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(doc.paths['/api/me']?.get?.security).toEqual([{ bearer: [] }]);
    expect(Object.keys(doc.paths['/api/me']?.get?.responses ?? {})).toEqual(['200', '401', '403', '503']);
    expect(doc.paths['/healthz']?.get?.security).toBeUndefined();
    const company = doc.paths['/api/companies/{companyId}'] as Record<
      string,
      { responses: Record<string, unknown> }
    >;
    expect(Object.keys(company).sort()).toEqual(['delete', 'get', 'patch']);
    expect(Object.keys(company.delete?.responses ?? {})).toEqual(['204', '400', '401', '403', '404', '422']);
  });

  it('serves the Swagger UI page with its assets from this server, not a CDN', async () => {
    const res = await t.app.request('/api/docs');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('/api/openapi.json');
    expect(html).toContain('/api/docs/assets/swagger-ui-dist/swagger-ui-bundle.js');
    expect(html).not.toMatch(/https?:\/\//);

    const css = await t.app.request('/api/docs/assets/swagger-ui-dist/swagger-ui.css');
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toContain('text/css');
    const js = await t.app.request('/api/docs/assets/swagger-ui-dist/swagger-ui-bundle.js');
    expect(js.headers.get('content-type')).toContain('javascript');
    expect((await js.arrayBuffer()).byteLength).toBeGreaterThan(100_000);
    // A second request comes from the cache.
    expect((await t.app.request('/api/docs/assets/swagger-ui-dist/swagger-ui.css')).status).toBe(200);
  });

  it('serves only the listed asset files', async () => {
    for (const file of ['package.json', 'index.html', '..%2F..%2Fpackage.json']) {
      expect((await t.app.request(`/api/docs/assets/swagger-ui-dist/${file}`)).status).toBe(404);
    }
  });
});
