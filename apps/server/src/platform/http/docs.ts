import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { swaggerUI } from '@hono/swagger-ui';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { AppDeps, AppEnv } from '../env.ts';

export const OPENAPI_PATH = '/api/openapi.json';
export const DOCS_PATH = '/api/docs';
/** The security scheme routes behind `authn()` name: `security: [{ [BEARER_SCHEME]: [] }]`. */
export const BEARER_SCHEME = 'bearer';
const ASSETS_BASE = `${DOCS_PATH}/assets`;

/** A route's JSON response in the OpenAPI document. */
export function jsonResponse<T>(description: string, schema: T) {
  return { description, content: { 'application/json': { schema } } };
}

/** A route's JSON request body, required (a request without it is a 400). */
export function jsonBody<T>(schema: T) {
  return { content: { 'application/json': { schema } }, required: true };
}

/** The Swagger UI files /api/docs loads, served from the installed swagger-ui-dist (no CDN). */
const ASSETS: Readonly<Record<string, string>> = {
  'swagger-ui.css': 'text/css; charset=utf-8',
  'swagger-ui-bundle.js': 'text/javascript; charset=utf-8',
};

const swaggerDist = dirname(createRequire(import.meta.url).resolve('swagger-ui-dist/package.json'));
const cache = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();

/** The generated OpenAPI 3.1 document and the Swagger UI that renders it. */
export function mountDocs(app: OpenAPIHono<AppEnv>, deps: AppDeps): void {
  app.openAPIRegistry.registerComponent('securitySchemes', BEARER_SCHEME, {
    type: 'http',
    scheme: 'bearer',
    description: 'A Clerk session token from the web app, or a personal API key (mwc_pk_...).',
  });
  app.doc31(OPENAPI_PATH, {
    openapi: '3.1.0',
    info: {
      title: 'Most Wanted Corp v2 API',
      version: deps.version,
      description: 'Humans and AI agents in one organization.',
    },
  });

  // @hono/swagger-ui builds asset URLs as `${baseUrl}/swagger-ui-dist/<file>`.
  app.get(
    DOCS_PATH,
    swaggerUI({ url: OPENAPI_PATH, baseUrl: ASSETS_BASE, title: 'Most Wanted Corp v2 API' }),
  );

  app.get(`${ASSETS_BASE}/swagger-ui-dist/:file`, async (c, next) => {
    const file = c.req.param('file');
    const type = ASSETS[file];
    if (!type) return next();
    let body = cache.get(file);
    if (!body) {
      // Copied once into a plain ArrayBuffer-backed array, which is what c.body() accepts.
      body = readFile(join(swaggerDist, file)).then((buffer) => new Uint8Array(buffer));
      cache.set(file, body);
    }
    return c.body(await body, 200, {
      'content-type': type,
      'cache-control': 'public, max-age=86400',
    });
  });
}
